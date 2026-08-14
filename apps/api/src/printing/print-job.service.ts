import {
  ApiErrorCode,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrintBatchStatus,
  PrintJobStatus,
  type PrintJobListQuery,
  type PrintJobListResult,
} from '@bake-mall/contracts';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { PrintBatch } from '../database/entities/print-batch.entity.js';
import { PrintJob } from '../database/entities/print-job.entity.js';
import { toPrintJobView } from './print-view.js';
import type { ReceiptPayload } from './receipt/receipt-payload.js';
import { renderXpyunReceipt } from './receipt/xpyun-receipt-renderer.js';
import {
  XPYUN_VENDOR_PORT,
  type XpyunPrintResult,
  type XpyunReceiptInput,
} from './xpyun/xpyun.types.js';

export const PRINT_JOB_NOW = Symbol('PRINT_JOB_NOW');
const ONLINE_STATUS_CACHE_MS = 30_000;

type PrintVendorPort = Readonly<{
  print: (input: XpyunReceiptInput) => Promise<XpyunPrintResult>;
}>;

type SubmissionIntent = Readonly<{
  jobId: string;
  batchId: string;
  leaseOwner: string;
  serialNumber: string;
  content: string;
}>;

type SubmissionClassification = Readonly<{
  status:
    PrintJobStatus.ACCEPTED | PrintJobStatus.FAILED | PrintJobStatus.UNKNOWN;
  vendorJobId: string | null;
  vendorErrorCode: string | null;
}>;

const statusConflict = (): ConflictException =>
  new ConflictException({
    code: ApiErrorCode.PRINT_JOB_STATUS_CONFLICT,
    message: 'Print job is not pending.',
  });

const printerUnavailable = (): ServiceUnavailableException =>
  new ServiceUnavailableException({
    code: ApiErrorCode.CLOUD_PRINTER_ONLINE_STATUS_UNKNOWN,
    message: 'Cloud printer is not active with a fresh online status.',
  });

const payloadOf = (job: PrintJob): ReceiptPayload => {
  if (job.payloadRedactedAt !== null || job.payloadJson === null) {
    throw new ConflictException({
      code: ApiErrorCode.PRINT_JOB_PAYLOAD_REDACTED,
      message: 'Print payload has been redacted.',
    });
  }
  return job.payloadJson as ReceiptPayload;
};

const classifyVendorResult = (
  result: XpyunPrintResult,
): SubmissionClassification => {
  if (result.classification === 'ACCEPTED') {
    return {
      status: PrintJobStatus.ACCEPTED,
      vendorJobId: result.vendorJobId,
      vendorErrorCode: null,
    };
  }
  if (
    result.classification === 'FAILED' ||
    result.classification === 'RATE_LIMITED'
  ) {
    return {
      status: PrintJobStatus.FAILED,
      vendorJobId: null,
      vendorErrorCode: result.vendorCode,
    };
  }
  return {
    status: PrintJobStatus.UNKNOWN,
    vendorJobId: null,
    vendorErrorCode: result.vendorCode,
  };
};

const classifyVendorError = (error: unknown): SubmissionClassification => {
  const record =
    error !== null && typeof error === 'object'
      ? (error as { classification?: unknown; vendorCode?: unknown })
      : undefined;
  const vendorCode =
    typeof record?.vendorCode === 'string' ? record.vendorCode : null;
  if (
    record?.classification === 'FAILED' ||
    record?.classification === 'RATE_LIMITED'
  ) {
    return {
      status: PrintJobStatus.FAILED,
      vendorJobId: null,
      vendorErrorCode: vendorCode,
    };
  }
  return {
    status: PrintJobStatus.UNKNOWN,
    vendorJobId: null,
    vendorErrorCode: vendorCode,
  };
};

@Injectable()
export class PrintJobService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(XPYUN_VENDOR_PORT)
    private readonly vendor: PrintVendorPort,
    private readonly audit: AuditService,
    @Optional()
    @Inject(PRINT_JOB_NOW)
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(query: PrintJobListQuery): Promise<PrintJobListResult> {
    const [jobs, total] = await this.dataSource
      .getRepository(PrintJob)
      .findAndCount({
        where: {
          ...(query.batchId === undefined ? {} : { batchId: query.batchId }),
          ...(query.orderId === undefined ? {} : { orderId: query.orderId }),
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        order: { id: 'DESC' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
    return {
      items: jobs.map(toPrintJobView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async submitPendingJob(
    jobId: string,
    adminId: string,
    batchId?: string,
    leaseOwner?: string,
  ): Promise<PrintJob> {
    const intent = await this.dataSource.transaction((manager) =>
      this.prepareSubmission(manager, jobId, batchId, leaseOwner),
    );

    let classification: SubmissionClassification;
    try {
      classification = classifyVendorResult(
        await this.vendor.print({
          serialNumber: intent.serialNumber,
          content: intent.content,
          tradeOrderId: `print-job-${intent.jobId}`,
        }),
      );
    } catch (error) {
      classification = classifyVendorError(error);
    }

    return this.dataSource.transaction((manager) =>
      this.finishSubmission(manager, intent, adminId, classification),
    );
  }

  private async prepareSubmission(
    manager: EntityManager,
    jobId: string,
    expectedBatchId?: string,
    expectedLeaseOwner?: string,
  ): Promise<SubmissionIntent> {
    const jobs = manager.getRepository(PrintJob);
    const candidate = await jobs.findOne({ where: { id: jobId } });
    if (!candidate) {
      throw new NotFoundException({
        code: ApiErrorCode.PRINT_JOB_NOT_FOUND,
        message: 'Print job not found.',
      });
    }
    const printer = await manager.getRepository(CloudPrinter).findOne({
      where: { id: candidate.printerId },
      lock: { mode: 'pessimistic_read' },
    });
    const checkedAt = printer?.lastStatusCheckedAt?.getTime() ?? 0;
    if (
      !printer ||
      printer.status !== CloudPrinterStatus.ACTIVE ||
      printer.lastOnlineStatus !== CloudPrinterOnlineStatus.ONLINE ||
      this.now().getTime() - checkedAt > ONLINE_STATUS_CACHE_MS
    ) {
      throw printerUnavailable();
    }

    const batch = await manager.getRepository(PrintBatch).findOne({
      where: { id: candidate.batchId },
      lock: { mode: 'pessimistic_write' },
    });
    const job = await jobs.findOne({
      where: { id: jobId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!job) {
      throw new NotFoundException({
        code: ApiErrorCode.PRINT_JOB_NOT_FOUND,
        message: 'Print job not found.',
      });
    }
    if (job.status !== PrintJobStatus.PENDING) throw statusConflict();
    const leaseOwner = expectedLeaseOwner ?? batch?.leaseOwner;
    if (
      !batch ||
      (expectedBatchId !== undefined && batch.id !== expectedBatchId) ||
      leaseOwner === null ||
      batch.leaseOwner !== leaseOwner ||
      batch.status !== PrintBatchStatus.RUNNING
    ) {
      throw new ConflictException({
        code: ApiErrorCode.PRINT_BATCH_LEASE_CONFLICT,
        message: 'Print batch lease ownership changed.',
      });
    }

    const content = renderXpyunReceipt(payloadOf(job));
    job.status = PrintJobStatus.SUBMITTING;
    job.vendorJobId = `print-job-${job.id}`;
    job.vendorErrorCode = null;
    job.acceptedAt = null;
    await jobs.save(job);
    return {
      jobId: job.id,
      batchId: batch.id,
      leaseOwner,
      serialNumber: printer.serialNumber,
      content,
    };
  }

  private async finishSubmission(
    manager: EntityManager,
    intent: SubmissionIntent,
    adminId: string,
    classification: SubmissionClassification,
  ): Promise<PrintJob> {
    const batch = await manager.getRepository(PrintBatch).findOne({
      where: { id: intent.batchId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !batch ||
      batch.status !== PrintBatchStatus.RUNNING ||
      batch.leaseOwner !== intent.leaseOwner
    ) {
      throw new ConflictException({
        code: ApiErrorCode.PRINT_BATCH_LEASE_CONFLICT,
        message: 'Print batch lease ownership changed.',
      });
    }
    const jobs = manager.getRepository(PrintJob);
    const job = await jobs.findOne({
      where: { id: intent.jobId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!job) {
      throw new NotFoundException({
        code: ApiErrorCode.PRINT_JOB_NOT_FOUND,
        message: 'Print job not found.',
      });
    }
    if (job.status !== PrintJobStatus.SUBMITTING) throw statusConflict();

    job.status = classification.status;
    job.unknownSinceAt =
      classification.status === PrintJobStatus.UNKNOWN ? this.now() : null;
    job.unknownQueryCount = 0;
    job.lastUnknownQueryAt = null;
    job.vendorJobId =
      classification.status === PrintJobStatus.UNKNOWN
        ? job.vendorJobId
        : classification.vendorJobId;
    job.vendorErrorCode = classification.vendorErrorCode;
    job.acceptedAt =
      classification.status === PrintJobStatus.ACCEPTED ? this.now() : null;
    const saved = await jobs.save(job);
    await this.audit.record(
      {
        actor: { type: 'ADMIN', adminUserId: adminId },
        targetEntity: 'print_jobs',
        targetId: saved.id,
        action: 'PRINT_JOB_PROCESS',
        changeSummary: {
          batchId: saved.batchId,
          orderId: saved.orderId,
          printerId: saved.printerId,
          status: saved.status,
          vendorErrorCode: saved.vendorErrorCode,
        },
      },
      manager,
    );
    return saved;
  }
}
