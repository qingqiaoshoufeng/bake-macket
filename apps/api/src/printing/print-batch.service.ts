import {
  ApiErrorCode,
  CloudPrinterStatus,
  OrderStatus,
  PrintBatchStatus,
  PrintJobStatus,
  type AppendPrintBatchRequest,
  type AppendPrintBatchResult,
  type CancelPrintBatchResult,
  type CreatePrintBatchRequest,
  type CreatePrintBatchResult,
  type CreateSinglePrintRequest,
  type CreateSinglePrintResult,
  type ProcessPrintBatchResult,
  type SealPrintBatchResult,
} from '@bake-mall/contracts';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { In, DataSource, type EntityManager } from 'typeorm';

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
  type OperationIdentity,
} from './admin-operation-idempotency.service.js';
import { hashPrintPayload } from './payload-hash.js';
import { PrintJobService } from './print-job.service.js';
import { PrintRecoveryService } from './print-recovery.service.js';
import {
  applyPrintBatchCounts,
  settledPrintBatchStatus,
} from './print-state.js';
import { toPrintBatchView, toPrintJobView } from './print-view.js';
import { buildReceiptPayload } from './receipt/receipt-payload.js';

export const PRINT_BATCH_NOW = Symbol('PRINT_BATCH_NOW');
const APPEND_LIMIT = 100;
const PROCESS_LIMIT = 20;
const LEASE_DURATION_MS = 60_000;
const PROCESSABLE_BATCH_STATUSES = new Set([
  PrintBatchStatus.READY,
  PrintBatchStatus.PAUSED,
]);
type ReplayClaim = Extract<AdminOperationClaim, { kind: 'REPLAY' }>;

const batchNotFound = (): NotFoundException =>
  new NotFoundException({
    code: ApiErrorCode.PRINT_BATCH_NOT_FOUND,
    message: 'Print batch not found.',
  });

const batchStatusConflict = (): ConflictException =>
  new ConflictException({
    code: ApiErrorCode.PRINT_BATCH_STATUS_CONFLICT,
    message: 'Print batch status does not allow this operation.',
  });

const appendLimitExceeded = (): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: ApiErrorCode.PRINT_BATCH_APPEND_LIMIT_EXCEEDED,
    message: `Each append chunk accepts at most ${APPEND_LIMIT} order IDs.`,
  });

const replaySnapshot = <T>(claim: ReplayClaim): T => {
  if (claim.status !== 'COMPLETED' || claim.responseSnapshot === null) {
    throw new ConflictException({
      code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
      message: 'The prior printing operation did not complete successfully.',
    });
  }
  return structuredClone(claim.responseSnapshot) as T;
};

@Injectable()
export class PrintBatchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly idempotency: AdminOperationIdempotencyService,
    private readonly audit: AuditService,
    private readonly printJobs: PrintJobService,
    private readonly recovery: PrintRecoveryService,
    @Optional()
    @Inject(PRINT_BATCH_NOW)
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(
    admin: AuthenticatedAdmin,
    request: CreatePrintBatchRequest,
    key: string,
  ): Promise<CreatePrintBatchResult> {
    return this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation: 'PRINT_BATCH_CREATE',
        key,
        request: { printerId: request.printerId },
      });
      if (claim.kind === 'REPLAY') {
        return replaySnapshot<CreatePrintBatchResult>(claim);
      }
      const printer = await manager.getRepository(CloudPrinter).findOne({
        where: { id: request.printerId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!printer || printer.status !== CloudPrinterStatus.ACTIVE) {
        throw new UnprocessableEntityException({
          code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
          message: 'Selected cloud printer is not active.',
        });
      }
      const batch = manager.getRepository(PrintBatch).create({
        printerId: printer.id,
        createdByAdminId: admin.id,
        status: PrintBatchStatus.DRAFT,
        leaseOwner: null,
        leaseExpiresAt: null,
        totalCount: 0,
        classifiedCount: 0,
        acceptedCount: 0,
        failedCount: 0,
        manualReviewCount: 0,
        manuallyResolvedCount: 0,
        cancelledCount: 0,
      });
      const saved = await manager.getRepository(PrintBatch).save(batch);
      const result = { batch: toPrintBatchView(saved, []) };
      await this.completeOperation(manager, claim.owner, saved, result);
      await this.recordBatchAudit(
        manager,
        admin.id,
        saved,
        'PRINT_BATCH_CREATE',
      );
      return result;
    });
  }

  async append(
    admin: AuthenticatedAdmin,
    batchId: string,
    request: AppendPrintBatchRequest,
    key: string,
  ): Promise<AppendPrintBatchResult> {
    const orderIds = [...new Set(request.orderIds)];
    if (request.orderIds.length > APPEND_LIMIT) throw appendLimitExceeded();
    if (orderIds.length === 0) throw appendLimitExceeded();

    return this.dataSource.transaction(async (manager) => {
      const normalizedRequest = { batchId, orderIds: [...orderIds].sort() };
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation: 'PRINT_BATCH_APPEND',
        key,
        request: normalizedRequest,
      });
      if (claim.kind === 'REPLAY') {
        return replaySnapshot<AppendPrintBatchResult>(claim);
      }
      const batch = await this.lockBatch(manager, batchId);
      if (batch.status !== PrintBatchStatus.DRAFT) throw batchStatusConflict();

      const orders = await manager.getRepository(Order).find({
        where: { id: In(orderIds) },
        order: { id: 'ASC' },
      });
      if (
        orders.length !== orderIds.length ||
        orders.some((order) => order.status === OrderStatus.CANCELLED)
      ) {
        throw new UnprocessableEntityException({
          code: ApiErrorCode.PRINT_ORDER_NOT_PRINTABLE,
          message: 'Append contains a missing or cancelled order.',
        });
      }
      const items = await manager.getRepository(OrderItem).find({
        where: { orderId: In(orderIds) },
        order: { orderId: 'ASC', id: 'ASC' },
      });
      const itemsByOrder = items.reduce<Map<string, OrderItem[]>>(
        (grouped, item) => {
          const current = grouped.get(item.orderId) ?? [];
          grouped.set(item.orderId, [...current, item]);
          return grouped;
        },
        new Map(),
      );
      const jobs = manager.getRepository(PrintJob);
      const createdJobs: PrintJob[] = [];
      for (const order of orders) {
        const existing = await jobs.findOne({
          where: { orderId: order.id },
          order: { sequence: 'DESC' },
          lock: { mode: 'pessimistic_read' },
        });
        const sequence = (existing?.sequence ?? 0) + 1;
        const payload = buildReceiptPayload(
          order,
          itemsByOrder.get(order.id) ?? [],
          {
            storeName: 'Bake Mall',
            printSequence: sequence,
            printedAt: this.now(),
            operatorMasked: `管理员 #***${admin.id.slice(-2)}`,
          },
        );
        createdJobs.push(
          jobs.create({
            batchId: batch.id,
            orderId: order.id,
            printerId: batch.printerId,
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
            supersedesJobId: null,
          }),
        );
      }
      const savedJobs = (await jobs.save(createdJobs)) as PrintJob[];
      batch.totalCount += savedJobs.length;
      const savedBatch = await manager.getRepository(PrintBatch).save(batch);
      const allJobs = await this.jobsForBatch(manager, savedBatch.id);
      const result = {
        batch: toPrintBatchView(savedBatch, allJobs),
        jobs: savedJobs.map(toPrintJobView),
      };
      await this.completeOperation(manager, claim.owner, savedBatch, result);
      await this.recordBatchAudit(
        manager,
        admin.id,
        savedBatch,
        'PRINT_BATCH_APPEND',
      );
      return result;
    });
  }

  async createSingle(
    admin: AuthenticatedAdmin,
    request: CreateSinglePrintRequest,
    key: string,
  ): Promise<CreateSinglePrintResult> {
    const prepared = await this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation: 'PRINT_SINGLE_CREATE',
        key,
        request: {
          orderId: request.orderId,
          printerId: request.printerId,
        },
      });
      if (claim.kind === 'REPLAY') {
        return {
          kind: 'REPLAY' as const,
          result: replaySnapshot<CreateSinglePrintResult>(claim),
        };
      }
      const printer = await manager.getRepository(CloudPrinter).findOne({
        where: { id: request.printerId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!printer || printer.status !== CloudPrinterStatus.ACTIVE) {
        throw new UnprocessableEntityException({
          code: ApiErrorCode.CLOUD_PRINTER_RECOVERY_REQUIRED,
          message: 'Selected cloud printer is not active.',
        });
      }
      const [order] = await manager.getRepository(Order).find({
        where: { id: In([request.orderId]) },
      });
      if (!order || order.status === OrderStatus.CANCELLED) {
        throw new UnprocessableEntityException({
          code: ApiErrorCode.PRINT_ORDER_NOT_PRINTABLE,
          message: 'Order is missing or cancelled.',
        });
      }
      const items = await manager.getRepository(OrderItem).find({
        where: { orderId: In([order.id]) },
        order: { id: 'ASC' },
      });
      const jobs = manager.getRepository(PrintJob);
      const previous = await jobs.findOne({
        where: { orderId: order.id },
        order: { sequence: 'DESC' },
        lock: { mode: 'pessimistic_read' },
      });
      const sequence = (previous?.sequence ?? 0) + 1;
      const payload = buildReceiptPayload(order, items, {
        storeName: 'Bake Mall',
        printSequence: sequence,
        printedAt: this.now(),
        operatorMasked: `管理员 #***${admin.id.slice(-2)}`,
      });
      const batch = manager.getRepository(PrintBatch).create({
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
      });
      const savedBatch = await manager.getRepository(PrintBatch).save(batch);
      const job = jobs.create({
        batchId: savedBatch.id,
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
        createdByAdminId: admin.id,
        manualResolution: null,
        manualResolutionByAdminId: null,
        manualResolutionAt: null,
        supersedesJobId: null,
      });
      const savedJob = (await jobs.save(job)) as PrintJob;
      return {
        kind: 'OWNER' as const,
        owner: claim.owner,
        batchId: savedBatch.id,
        jobId: savedJob.id,
      };
    });
    if (prepared.kind === 'REPLAY') return prepared.result;

    const processed = await this.process(
      admin,
      prepared.batchId,
      key,
      'PRINT_SINGLE_PROCESS',
    );
    return this.dataSource.transaction(async (manager) => {
      const batch = await this.lockBatch(manager, prepared.batchId);
      const jobs = await this.jobsForBatch(manager, prepared.batchId);
      const job = jobs.find(({ id }) => id === prepared.jobId);
      if (!job) throw new Error('Single print job disappeared');
      const result = {
        batch: processed.batch,
        job: toPrintJobView(job),
      };
      await this.completeOperation(manager, prepared.owner, batch, result);
      await this.recordBatchAudit(
        manager,
        admin.id,
        batch,
        'PRINT_SINGLE_CREATE',
      );
      return result;
    });
  }

  seal(
    admin: AuthenticatedAdmin,
    batchId: string,
    key: string,
  ): Promise<SealPrintBatchResult> {
    return this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation: 'PRINT_BATCH_SEAL',
        key,
        request: { batchId },
      });
      if (claim.kind === 'REPLAY') {
        return replaySnapshot<SealPrintBatchResult>(claim);
      }
      const batch = await this.lockBatch(manager, batchId);
      if (batch.status !== PrintBatchStatus.DRAFT || batch.totalCount === 0) {
        throw batchStatusConflict();
      }
      batch.status = PrintBatchStatus.READY;
      const saved = await manager.getRepository(PrintBatch).save(batch);
      const jobs = await this.jobsForBatch(manager, saved.id);
      const result = { batch: toPrintBatchView(saved, jobs) };
      await this.completeOperation(manager, claim.owner, saved, result);
      await this.recordBatchAudit(manager, admin.id, saved, 'PRINT_BATCH_SEAL');
      return result;
    });
  }

  cancel(
    admin: AuthenticatedAdmin,
    batchId: string,
    key: string,
  ): Promise<CancelPrintBatchResult> {
    return this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation: 'PRINT_BATCH_CANCEL',
        key,
        request: { batchId },
      });
      if (claim.kind === 'REPLAY') {
        return replaySnapshot<CancelPrintBatchResult>(claim);
      }

      const batch = await this.lockBatch(manager, batchId);
      if (
        batch.status !== PrintBatchStatus.DRAFT &&
        batch.status !== PrintBatchStatus.READY &&
        batch.status !== PrintBatchStatus.PAUSED
      ) {
        throw batchStatusConflict();
      }
      const jobs = await this.jobsForBatch(manager, batch.id, true);
      const hasUnsettledSubmission = jobs.some(({ status }) =>
        [
          PrintJobStatus.SUBMITTING,
          PrintJobStatus.UNKNOWN,
          PrintJobStatus.MANUAL_REVIEW,
        ].includes(status),
      );
      if (hasUnsettledSubmission) throw batchStatusConflict();

      const cancelledJobs = jobs.map((job) => {
        if (job.status === PrintJobStatus.PENDING) {
          job.status = PrintJobStatus.CANCELLED;
        }
        return job;
      });
      await manager.getRepository(PrintJob).save(cancelledJobs);
      applyPrintBatchCounts(batch, cancelledJobs);
      batch.status = PrintBatchStatus.CANCELLED;
      batch.leaseOwner = null;
      batch.leaseExpiresAt = null;
      const saved = await manager.getRepository(PrintBatch).save(batch);
      const result = { batch: toPrintBatchView(saved, cancelledJobs) };
      await this.completeOperation(manager, claim.owner, saved, result);
      await this.recordBatchAudit(
        manager,
        admin.id,
        saved,
        'PRINT_BATCH_CANCEL',
      );
      return result;
    });
  }

  async process(
    admin: AuthenticatedAdmin,
    batchId: string,
    key: string,
    operation = 'PRINT_BATCH_PROCESS',
  ): Promise<ProcessPrintBatchResult> {
    const prepared = await this.dataSource.transaction(async (manager) => {
      const claim = await this.idempotency.claim(manager, {
        adminId: admin.id,
        operation,
        key,
        request: { batchId },
      });
      if (claim.kind === 'REPLAY') {
        return {
          kind: 'REPLAY' as const,
          result: replaySnapshot<ProcessPrintBatchResult>(claim),
        };
      }
      const batch = await this.lockBatch(manager, batchId);
      const now = this.now();
      const expiredRunning =
        batch.status === PrintBatchStatus.RUNNING &&
        batch.leaseExpiresAt !== null &&
        batch.leaseExpiresAt <= now;
      if (
        (!PROCESSABLE_BATCH_STATUSES.has(batch.status) && !expiredRunning) ||
        (batch.status === PrintBatchStatus.RUNNING && !expiredRunning) ||
        (batch.leaseExpiresAt !== null &&
          batch.leaseExpiresAt > now &&
          batch.status !== PrintBatchStatus.RUNNING)
      ) {
        throw new ConflictException({
          code: ApiErrorCode.PRINT_BATCH_LEASE_CONFLICT,
          message: 'Print batch is not available for processing.',
        });
      }
      batch.status = PrintBatchStatus.RUNNING;
      batch.leaseOwner = randomUUID();
      batch.leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
      await manager.getRepository(PrintBatch).save(batch);
      const pendingJobs = (await this.jobsForBatch(manager, batch.id))
        .filter(({ status }) => status === PrintJobStatus.PENDING)
        .slice(0, PROCESS_LIMIT);
      return {
        kind: 'OWNER' as const,
        owner: claim.owner,
        leaseOwner: batch.leaseOwner,
        recoveryOnly: expiredRunning,
        jobIds: expiredRunning ? [] : pendingJobs.map(({ id }) => id),
      };
    });
    if (prepared.kind === 'REPLAY') return prepared.result;

    if (prepared.recoveryOnly) {
      await this.recovery.recoverSubmittingJobs(batchId, admin.id);
    }
    const processed: PrintJob[] = [];
    for (const jobId of prepared.jobIds) {
      try {
        await this.renewLease(batchId, prepared.leaseOwner);
        processed.push(
          await this.printJobs.submitPendingJob(
            jobId,
            admin.id,
            batchId,
            prepared.leaseOwner,
          ),
        );
      } catch (error) {
        if (this.isLeaseConflict(error)) break;
        // A job-level failure must not stop later jobs; the final database
        // recount remains authoritative for the batch outcome.
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const batch = await this.lockBatch(manager, batchId);
      if (
        batch.status !== PrintBatchStatus.RUNNING ||
        batch.leaseOwner !== prepared.leaseOwner
      ) {
        throw new ConflictException({
          code: ApiErrorCode.PRINT_BATCH_LEASE_CONFLICT,
          message: 'Print batch lease ownership changed.',
        });
      }
      const jobs = await this.jobsForBatch(manager, batch.id);
      applyPrintBatchCounts(batch, jobs);
      batch.status = settledPrintBatchStatus(batch, jobs);
      batch.leaseOwner = null;
      batch.leaseExpiresAt = null;
      const saved = await manager.getRepository(PrintBatch).save(batch);
      const result: ProcessPrintBatchResult = {
        batch: toPrintBatchView(saved, jobs),
        processedCount: processed.length,
        accepted: processed.filter(
          ({ status }) => status === PrintJobStatus.ACCEPTED,
        ).length,
        failed: processed.filter(
          ({ status }) => status === PrintJobStatus.FAILED,
        ).length,
        unknown: processed.filter(
          ({ status }) => status === PrintJobStatus.UNKNOWN,
        ).length,
        manualReview: processed.filter(
          ({ status }) => status === PrintJobStatus.MANUAL_REVIEW,
        ).length,
      };
      await this.completeOperation(manager, prepared.owner, saved, result);
      await this.recordBatchAudit(
        manager,
        admin.id,
        saved,
        'PRINT_BATCH_PROCESS',
      );
      return result;
    });
  }

  private renewLease(batchId: string, leaseOwner: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const batch = await this.lockBatch(manager, batchId);
      if (
        batch.status !== PrintBatchStatus.RUNNING ||
        batch.leaseOwner !== leaseOwner
      ) {
        throw new ConflictException({
          code: ApiErrorCode.PRINT_BATCH_LEASE_CONFLICT,
          message: 'Print batch lease ownership changed.',
        });
      }
      batch.leaseExpiresAt = new Date(
        this.now().getTime() + LEASE_DURATION_MS,
      );
      await manager.getRepository(PrintBatch).save(batch);
    });
  }

  private isLeaseConflict(error: unknown): boolean {
    return (
      error instanceof ConflictException &&
      (error.getResponse() as { code?: unknown }).code ===
        ApiErrorCode.PRINT_BATCH_LEASE_CONFLICT
    );
  }

  private async lockBatch(
    manager: EntityManager,
    batchId: string,
  ): Promise<PrintBatch> {
    const batch = await manager.getRepository(PrintBatch).findOne({
      where: { id: batchId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!batch) throw batchNotFound();
    return batch;
  }

  private jobsForBatch(
    manager: EntityManager,
    batchId: string,
    forUpdate = false,
  ): Promise<PrintJob[]> {
    return manager.getRepository(PrintJob).find({
      where: { batchId },
      order: { sequence: 'ASC', id: 'ASC' },
      ...(forUpdate ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  private async completeOperation(
    manager: EntityManager,
    owner: OperationIdentity,
    batch: PrintBatch,
    responseSnapshot: Record<string, unknown>,
  ): Promise<void> {
    await this.idempotency.complete(manager, {
      owner,
      resourceType: 'PRINT_BATCH',
      resourceId: batch.id,
      responseSnapshot,
      sensitiveValues: [],
    });
  }

  private async recordBatchAudit(
    manager: EntityManager,
    adminId: string,
    batch: PrintBatch,
    action: string,
  ): Promise<void> {
    await this.audit.record(
      {
        actor: { type: 'ADMIN', adminUserId: adminId },
        targetEntity: 'print_batches',
        targetId: batch.id,
        action,
        changeSummary: {
          printerId: batch.printerId,
          status: batch.status,
          totalCount: batch.totalCount,
        },
      },
      manager,
    );
  }
}
