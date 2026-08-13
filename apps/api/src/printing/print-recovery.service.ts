import {
  ApiErrorCode,
  CloudPrinterStatus,
  ManualPrintResolution,
  OrderStatus,
  PrintBatchStatus,
  PrintJobStatus,
  type ConfirmNotPrintedManualPrintRequest,
  type ConfirmPrintedManualPrintRequest,
  type FailedPrintRetryRequest,
  type FailedPrintRetryResult,
  type ManualPrintResolutionResult,
  type RetryWithDuplicateRiskManualPrintRequest,
  type QueryUnknownPrintJobResult,
} from '@bake-mall/contracts';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { OrderItem } from '../database/entities/order-item.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { PrintBatch } from '../database/entities/print-batch.entity.js';
import { PrintJob } from '../database/entities/print-job.entity.js';
import {
  AdminOperationIdempotencyService,
  type AdminOperationClaim,
} from './admin-operation-idempotency.service.js';
import { hashPrintPayload } from './payload-hash.js';
import { applyPrintBatchCounts, settledPrintBatchStatus } from './print-state.js';
import { toPrintBatchView, toPrintJobView } from './print-view.js';
import { buildReceiptPayload } from './receipt/receipt-payload.js';
import {
  XPYUN_VENDOR_PORT,
  type XpyunOrderResult,
} from './xpyun/xpyun.types.js';

export const PRINT_RECOVERY_NOW = Symbol('PRINT_RECOVERY_NOW');
const UNKNOWN_QUERY_LIMIT = 3;

type RecoveryVendorPort = Readonly<{
  queryOrder: (vendorJobId: string) => Promise<XpyunOrderResult>;
}>;

type ReplayClaim = Extract<AdminOperationClaim, { kind: 'REPLAY' }>;
type VendorEvidence =
  | Readonly<{ kind: 'ACCEPTED' }>
  | Readonly<{ kind: 'FAILED' }>
  | Readonly<{ kind: 'UNKNOWN' }>;

const replaySnapshot = (claim: ReplayClaim): QueryUnknownPrintJobResult => {
  if (claim.status !== 'COMPLETED' || claim.responseSnapshot === null) {
    throw new ConflictException({
      code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
      message: 'The prior print recovery operation did not complete.',
    });
  }
  return structuredClone(
    claim.responseSnapshot,
  ) as QueryUnknownPrintJobResult;
};

const statusConflict = (): ConflictException =>
  new ConflictException({
    code: ApiErrorCode.PRINT_JOB_STATUS_CONFLICT,
    message: 'Print job is not awaiting an UNKNOWN query.',
  });

@Injectable()
export class PrintRecoveryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly idempotency: AdminOperationIdempotencyService,
    private readonly audit: AuditService,
    @Inject(XPYUN_VENDOR_PORT)
    private readonly vendor: RecoveryVendorPort,
    @Optional()
    @Inject(PRINT_RECOVERY_NOW)
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recoverSubmittingJobs(
    batchId: string,
    adminId: string,
  ): Promise<void> {
    const jobs = await this.dataSource.getRepository(PrintJob).find({
      where: { batchId, status: PrintJobStatus.SUBMITTING },
      order: { id: 'ASC' },
    });
    for (const job of jobs) {
      const evidence = await this.queryEvidence(job.vendorJobId);
      await this.dataSource.transaction(async (manager) => {
        const current = await this.lockJob(manager, job.id);
        if (current.status !== PrintJobStatus.SUBMITTING) return;
        current.status =
          evidence.kind === 'ACCEPTED'
            ? PrintJobStatus.ACCEPTED
            : evidence.kind === 'FAILED'
              ? PrintJobStatus.FAILED
              : PrintJobStatus.UNKNOWN;
        current.unknownSinceAt =
          current.status === PrintJobStatus.UNKNOWN ? this.now() : null;
        current.acceptedAt =
          current.status === PrintJobStatus.ACCEPTED
            ? this.now()
            : current.acceptedAt;
        await manager.getRepository(PrintJob).save(current);
        await this.audit.record(
          {
            actor: { type: 'ADMIN', adminUserId: adminId },
            targetEntity: 'print_jobs',
            targetId: current.id,
            action: 'PRINT_JOB_SUBMISSION_RECOVERED',
            changeSummary: { batchId, status: current.status },
          },
          manager,
        );
      });
    }
  }

  async queryUnknown(
    admin: AuthenticatedAdmin,
    jobId: string,
    key: string,
  ): Promise<QueryUnknownPrintJobResult> {
    const prepared = await this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation: 'PRINT_JOB_QUERY_UNKNOWN',
        key,
        request: { jobId },
      });
      if (claim.kind === 'REPLAY') {
        return { kind: 'REPLAY' as const, result: replaySnapshot(claim) };
      }
      const job = await this.lockJob(manager, jobId);
      if (job.status !== PrintJobStatus.UNKNOWN) throw statusConflict();
      return {
        kind: 'OWNER' as const,
        owner: claim.owner,
        vendorJobId: job.vendorJobId,
      };
    });
    if (prepared.kind === 'REPLAY') return prepared.result;

    const evidence = await this.queryEvidence(prepared.vendorJobId);
    return this.dataSource.transaction(async (manager) => {
      const job = await this.lockJob(manager, jobId);
      if (job.status !== PrintJobStatus.UNKNOWN) throw statusConflict();
      const queriedAt = this.now();
      job.unknownSinceAt ??= queriedAt;
      job.unknownQueryCount += 1;
      job.lastUnknownQueryAt = queriedAt;
      job.status =
        evidence.kind === 'ACCEPTED'
          ? PrintJobStatus.ACCEPTED
          : evidence.kind === 'FAILED'
            ? PrintJobStatus.FAILED
            : job.unknownQueryCount >= UNKNOWN_QUERY_LIMIT
              ? PrintJobStatus.MANUAL_REVIEW
              : PrintJobStatus.UNKNOWN;
      job.acceptedAt =
        job.status === PrintJobStatus.ACCEPTED ? queriedAt : job.acceptedAt;
      const savedJob = await manager.getRepository(PrintJob).save(job);

      const batch = await this.lockBatch(manager, savedJob.batchId);
      const jobs = await this.jobsForBatch(manager, batch.id);
      applyPrintBatchCounts(batch, jobs);
      batch.status =
        batch.status === PrintBatchStatus.CANCELLED
          ? batch.status
          : settledPrintBatchStatus(batch, jobs);
      const savedBatch = await manager.getRepository(PrintBatch).save(batch);
      const result = {
        batch: toPrintBatchView(savedBatch, jobs),
        job: toPrintJobView(savedJob),
      };
      await this.idempotency.complete(manager, {
        owner: prepared.owner,
        resourceType: 'PRINT_JOB',
        resourceId: savedJob.id,
        responseSnapshot: result,
        sensitiveValues: [],
      });
      await this.audit.record(
        {
          actor: { type: 'ADMIN', adminUserId: admin.id },
          targetEntity: 'print_jobs',
          targetId: savedJob.id,
          action: 'PRINT_JOB_QUERY_UNKNOWN',
          changeSummary: {
            batchId: savedJob.batchId,
            status: savedJob.status,
            vendorErrorCode: savedJob.vendorErrorCode,
          },
        },
        manager,
      );
      return result;
    });
  }

  resolveManual(
    admin: AuthenticatedAdmin,
    jobId: string,
    request:
      | ConfirmPrintedManualPrintRequest
      | ConfirmNotPrintedManualPrintRequest,
    key: string,
  ): Promise<ManualPrintResolutionResult> {
    return this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation: 'PRINT_JOB_MANUAL_RESOLUTION',
        key,
        request: { jobId, ...request },
      });
      if (claim.kind === 'REPLAY') {
        if (claim.status !== 'COMPLETED' || claim.responseSnapshot === null) {
          throw new ConflictException({
            code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
            message: 'The prior manual resolution did not complete.',
          });
        }
        return structuredClone(
          claim.responseSnapshot,
        ) as ManualPrintResolutionResult;
      }

      const job = await this.lockJob(manager, jobId);
      if (job.status !== PrintJobStatus.MANUAL_REVIEW) throw statusConflict();
      job.status =
        request.resolution === ManualPrintResolution.CONFIRM_PRINTED
          ? PrintJobStatus.MANUALLY_CONFIRMED_PRINTED
          : PrintJobStatus.FAILED;
      job.manualResolution = request.resolution;
      job.manualResolutionByAdminId = admin.id;
      job.manualResolutionAt = this.now();
      const savedJob = await manager.getRepository(PrintJob).save(job);

      const batch = await this.lockBatch(manager, savedJob.batchId);
      const jobs = await this.jobsForBatch(manager, batch.id);
      applyPrintBatchCounts(batch, jobs);
      batch.status = settledPrintBatchStatus(batch, jobs);
      const savedBatch = await manager.getRepository(PrintBatch).save(batch);
      const result = {
        resolution: request.resolution,
        batch: toPrintBatchView(savedBatch, jobs),
        job: toPrintJobView(savedJob),
      } as ManualPrintResolutionResult;
      await this.idempotency.complete(manager, {
        owner: claim.owner,
        resourceType: 'PRINT_JOB',
        resourceId: savedJob.id,
        responseSnapshot: result,
        sensitiveValues: [],
      });
      await this.audit.record(
        {
          actor: { type: 'ADMIN', adminUserId: admin.id },
          targetEntity: 'print_jobs',
          targetId: savedJob.id,
          action: 'PRINT_JOB_MANUAL_RESOLUTION',
          changeSummary: {
            batchId: savedJob.batchId,
            status: savedJob.status,
            resolution: request.resolution,
          },
        },
        manager,
      );
      return result;
    });
  }

  retryFailed(
    admin: AuthenticatedAdmin,
    jobId: string,
    request: FailedPrintRetryRequest,
    key: string,
  ): Promise<FailedPrintRetryResult> {
    return this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation: 'PRINT_JOB_RETRY_FAILED',
        key,
        request: { jobId, ...request },
      });
      if (claim.kind === 'REPLAY') {
        if (claim.status !== 'COMPLETED' || claim.responseSnapshot === null) {
          throw new ConflictException({
            code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
            message: 'The prior failed print retry did not complete.',
          });
        }
        return structuredClone(claim.responseSnapshot) as FailedPrintRetryResult;
      }

      const printer = await manager.getRepository(CloudPrinter).findOne({
        where: { id: request.printerId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!printer || printer.status !== CloudPrinterStatus.ACTIVE) {
        throw new ConflictException({
          code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
          message: 'Selected cloud printer is not active.',
        });
      }
      const originalJob = await this.lockJob(manager, jobId);
      if (originalJob.status !== PrintJobStatus.FAILED) throw statusConflict();
      const order = await manager.getRepository(Order).findOne({
        where: { id: originalJob.orderId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!order || order.status === OrderStatus.CANCELLED) {
        throw new ConflictException({
          code: ApiErrorCode.PRINT_ORDER_NOT_PRINTABLE,
          message: 'Order is missing or cancelled.',
        });
      }
      const items = await manager.getRepository(OrderItem).find({
        where: { orderId: order.id },
        order: { id: 'ASC' },
      });
      const previous = await manager.getRepository(PrintJob).findOne({
        where: { orderId: order.id },
        order: { sequence: 'DESC' },
        lock: { mode: 'pessimistic_read' },
      });
      const sequence = (previous?.sequence ?? originalJob.sequence) + 1;
      const payload = buildReceiptPayload(order, items, {
        storeName: 'Bake Mall',
        printSequence: sequence,
        printedAt: this.now(),
        operatorMasked: `管理员 #***${admin.id.slice(-2)}`,
      });
      const batchRepository = manager.getRepository(PrintBatch);
      const retryBatch = await batchRepository.save(
        batchRepository.create({
          printerId: printer.id,
          createdByAdminId: admin.id,
          status: PrintBatchStatus.READY,
          leaseOwner: null,
          leaseExpiresAt: null,
          totalCount: 1,
          classifiedCount: 0,
          acceptedCount: 0,
          failedCount: 0,
          manualReviewCount: 0,
          manuallyResolvedCount: 0,
          cancelledCount: 0,
        }),
      );
      const jobRepository = manager.getRepository(PrintJob);
      const retryJob = await jobRepository.save(
        jobRepository.create({
          batchId: retryBatch.id,
          orderId: order.id,
          printerId: printer.id,
          sequence,
          status: PrintJobStatus.PENDING,
          payloadJson: payload,
          payloadHash: hashPrintPayload(payload),
          payloadRedactedAt: null,
          vendorJobId: null,
          vendorErrorCode: null,
          acceptedAt: null,
          unknownSinceAt: null,
          unknownQueryCount: 0,
          lastUnknownQueryAt: null,
          createdByAdminId: admin.id,
          manualResolution: null,
          manualResolutionByAdminId: null,
          manualResolutionAt: null,
          supersedesJobId: originalJob.id,
        }),
      );
      const result = {
        batch: toPrintBatchView(retryBatch, [retryJob]),
        job: toPrintJobView(retryJob),
      };
      await this.idempotency.complete(manager, {
        owner: claim.owner,
        resourceType: 'PRINT_JOB',
        resourceId: retryJob.id,
        responseSnapshot: result,
        sensitiveValues: [],
      });
      await this.audit.record(
        {
          actor: { type: 'ADMIN', adminUserId: admin.id },
          targetEntity: 'print_jobs',
          targetId: originalJob.id,
          action: 'PRINT_JOB_FAILED_RETRY_CREATED',
          changeSummary: {
            batchId: originalJob.batchId,
            retryBatchId: retryBatch.id,
            retryJobId: retryJob.id,
          },
        },
        manager,
      );
      return result;
    });
  }

  resolveManualRetry(
    admin: AuthenticatedAdmin,
    jobId: string,
    request: RetryWithDuplicateRiskManualPrintRequest,
    key: string,
  ): Promise<ManualPrintResolutionResult> {
    return this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation: 'PRINT_JOB_MANUAL_RESOLUTION',
        key,
        request: { jobId, ...request },
      });
      if (claim.kind === 'REPLAY') {
        if (claim.status !== 'COMPLETED' || claim.responseSnapshot === null) {
          throw new ConflictException({
            code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
            message: 'The prior duplicate-risk retry did not complete.',
          });
        }
        return structuredClone(
          claim.responseSnapshot,
        ) as ManualPrintResolutionResult;
      }
      if (request.confirmDuplicateRisk !== true) throw statusConflict();
      const printer = await manager.getRepository(CloudPrinter).findOne({
        where: { id: request.printerId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!printer || printer.status !== CloudPrinterStatus.ACTIVE) {
        throw new ConflictException({
          code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
          message: 'Selected cloud printer is not active.',
        });
      }
      const originalJob = await this.lockJob(manager, jobId);
      if (originalJob.status !== PrintJobStatus.MANUAL_REVIEW) {
        throw statusConflict();
      }
      const order = await manager.getRepository(Order).findOne({
        where: { id: originalJob.orderId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!order || order.status === OrderStatus.CANCELLED) {
        throw new ConflictException({
          code: ApiErrorCode.PRINT_ORDER_NOT_PRINTABLE,
          message: 'Order is missing or cancelled.',
        });
      }
      const items = await manager.getRepository(OrderItem).find({
        where: { orderId: order.id },
        order: { id: 'ASC' },
      });
      const previous = await manager.getRepository(PrintJob).findOne({
        where: { orderId: order.id },
        order: { sequence: 'DESC' },
        lock: { mode: 'pessimistic_read' },
      });
      const sequence = (previous?.sequence ?? originalJob.sequence) + 1;
      const payload = buildReceiptPayload(order, items, {
        storeName: 'Bake Mall',
        printSequence: sequence,
        printedAt: this.now(),
        operatorMasked: `管理员 #***${admin.id.slice(-2)}`,
      });
      originalJob.status = PrintJobStatus.MANUALLY_CLOSED;
      originalJob.manualResolution = request.resolution;
      originalJob.manualResolutionByAdminId = admin.id;
      originalJob.manualResolutionAt = this.now();
      await manager.getRepository(PrintJob).save(originalJob);
      const originalBatch = await this.lockBatch(manager, originalJob.batchId);
      const originalJobs = await this.jobsForBatch(manager, originalBatch.id);
      applyPrintBatchCounts(originalBatch, originalJobs);
      originalBatch.status = settledPrintBatchStatus(originalBatch, originalJobs);
      const savedOriginalBatch = await manager
        .getRepository(PrintBatch)
        .save(originalBatch);

      const retryBatch = await manager.getRepository(PrintBatch).save(
        manager.getRepository(PrintBatch).create({
          printerId: printer.id,
          createdByAdminId: admin.id,
          status: PrintBatchStatus.READY,
          leaseOwner: null,
          leaseExpiresAt: null,
          totalCount: 1,
          classifiedCount: 0,
          acceptedCount: 0,
          failedCount: 0,
          manualReviewCount: 0,
          manuallyResolvedCount: 0,
          cancelledCount: 0,
        }),
      );
      const retryJob = await manager.getRepository(PrintJob).save(
        manager.getRepository(PrintJob).create({
          batchId: retryBatch.id,
          orderId: order.id,
          printerId: printer.id,
          sequence,
          status: PrintJobStatus.PENDING,
          payloadJson: payload,
          payloadHash: hashPrintPayload(payload),
          payloadRedactedAt: null,
          vendorJobId: null,
          vendorErrorCode: null,
          acceptedAt: null,
          unknownSinceAt: null,
          unknownQueryCount: 0,
          lastUnknownQueryAt: null,
          createdByAdminId: admin.id,
          manualResolution: null,
          manualResolutionByAdminId: null,
          manualResolutionAt: null,
          supersedesJobId: originalJob.id,
        }),
      );
      const result = {
        resolution: request.resolution,
        batch: toPrintBatchView(savedOriginalBatch, originalJobs),
        job: toPrintJobView(originalJob),
        retryBatch: toPrintBatchView(retryBatch, [retryJob]),
        retryJob: toPrintJobView(retryJob),
      } as ManualPrintResolutionResult;
      await this.idempotency.complete(manager, {
        owner: claim.owner,
        resourceType: 'PRINT_JOB',
        resourceId: originalJob.id,
        responseSnapshot: result,
        sensitiveValues: [],
      });
      await this.audit.record(
        {
          actor: { type: 'ADMIN', adminUserId: admin.id },
          targetEntity: 'print_jobs',
          targetId: originalJob.id,
          action: 'PRINT_JOB_DUPLICATE_RISK_RETRY_CREATED',
          changeSummary: {
            batchId: originalJob.batchId,
            status: originalJob.status,
            retryBatchId: retryBatch.id,
            retryJobId: retryJob.id,
          },
        },
        manager,
      );
      return result;
    });
  }

  private async queryEvidence(
    vendorJobId: string | null,
  ): Promise<VendorEvidence> {
    if (vendorJobId === null) return { kind: 'UNKNOWN' };
    try {
      const result = await this.vendor.queryOrder(vendorJobId);
      return { kind: result.printed ? 'ACCEPTED' : 'FAILED' };
    } catch {
      return { kind: 'UNKNOWN' };
    }
  }

  private async lockJob(
    manager: EntityManager,
    jobId: string,
  ): Promise<PrintJob> {
    const job = await manager.getRepository(PrintJob).findOne({
      where: { id: jobId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!job) {
      throw new NotFoundException({
        code: ApiErrorCode.PRINT_JOB_NOT_FOUND,
        message: 'Print job not found.',
      });
    }
    return job;
  }

  private async lockBatch(
    manager: EntityManager,
    batchId: string,
  ): Promise<PrintBatch> {
    const batch = await manager.getRepository(PrintBatch).findOne({
      where: { id: batchId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!batch) {
      throw new NotFoundException({
        code: ApiErrorCode.PRINT_BATCH_NOT_FOUND,
        message: 'Print batch not found.',
      });
    }
    return batch;
  }

  private jobsForBatch(
    manager: EntityManager,
    batchId: string,
  ): Promise<PrintJob[]> {
    return manager.getRepository(PrintJob).find({
      where: { batchId },
      order: { sequence: 'ASC', id: 'ASC' },
    });
  }
}
