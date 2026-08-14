import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  FulfillmentType,
  PrintJobStatus,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { PrintBatch } from '../database/entities/print-batch.entity.js';
import { PrintJob } from '../database/entities/print-job.entity.js';
import type { ReceiptPayload } from './receipt/receipt-payload.js';
import { PrintJobService } from './print-job.service.js';

const receiptPayload = (): ReceiptPayload => ({
  schemaVersion: 1,
  storeName: 'Bake Mall',
  order: {
    id: '9',
    orderNo: 'BM202608110009',
    orderedAt: '2026-08-11T02:03:04.000Z',
  },
  customer: { name: '林女士', phoneMasked: '138****0000' },
  fulfillment: { type: FulfillmentType.PICKUP },
  items: [
    {
      productName: '蛋糕',
      skuName: '六寸',
      skuAttributes: { size: '六寸' },
      unitPriceCents: 8_920,
      quantity: 1,
      lineGoodsTotalCents: 8_920,
      lineMembershipDiscountCents: 0,
      linePayableCents: 8_920,
    },
  ],
  totals: {
    goodsTotalCents: 8_920,
    membershipDiscountCents: 0,
    creditAppliedCents: 0,
    payableTotalCents: 8_920,
  },
  remark: null,
  print: {
    sequence: 1,
    printedAt: '2026-08-11T03:04:05.000Z',
    operatorMasked: '管理员 #***1',
  },
});

const setup = (
  vendorOutcome:
    | Readonly<{
        classification: 'ACCEPTED';
        vendorCode: string;
        vendorJobId: string;
      }>
    | Readonly<{
        classification: 'FAILED';
        vendorCode: string | null;
        vendorJobId: null;
      }>
    | Error,
  initialStatus = PrintJobStatus.PENDING,
) => {
  const trace: string[] = [];
  let inTransaction = false;
  const printer = Object.assign(new CloudPrinter(), {
    id: '4',
    serialNumber: 'SN-SECRET-0004',
    status: CloudPrinterStatus.ACTIVE,
    lastOnlineStatus: CloudPrinterOnlineStatus.ONLINE,
    lastStatusCheckedAt: new Date('2026-08-11T03:03:50.000Z'),
  });
  const batch = Object.assign(new PrintBatch(), {
    id: '7',
    status: 'RUNNING',
    leaseOwner: 'lease-1',
  });
  const job = Object.assign(new PrintJob(), {
    id: '12',
    batchId: '7',
    orderId: '9',
    printerId: printer.id,
    sequence: 1,
    status: initialStatus,
    payloadJson: receiptPayload(),
    payloadHash: 'a'.repeat(64),
    payloadRedactedAt: null,
    vendorJobId: null,
    vendorErrorCode: null,
    acceptedAt: null,
    createdByAdminId: '1',
  });
  Object.assign(job, {
    manualResolution: null,
    manualResolutionByAdminId: null,
    manualResolutionAt: null,
    supersedesJobId: null,
    createdAt: new Date('2026-08-11T03:00:00.000Z'),
    updatedAt: new Date('2026-08-11T03:00:00.000Z'),
  });
  const jobRepository = {
    findOne: vi.fn(async () => job),
    findAndCount: vi.fn(async () => [[job], 1] as const),
    save: vi.fn(async (saved: PrintJob) => {
      trace.push(`db:${saved.status}`);
      return saved;
    }),
  };
  const printerRepository = { findOne: vi.fn(async () => printer) };
  const batchRepository = { findOne: vi.fn(async () => batch) };
  const manager = {
    getRepository: vi.fn((entity: unknown) =>
      entity === PrintJob
        ? jobRepository
        : entity === PrintBatch
          ? batchRepository
          : printerRepository,
    ),
  };
  const dataSource = {
    getRepository: vi.fn(() => jobRepository),
    transaction: vi.fn(
      async (work: (transactionManager: typeof manager) => unknown) => {
        expect(inTransaction).toBe(false);
        inTransaction = true;
        try {
          return await work(manager);
        } finally {
          inTransaction = false;
        }
      },
    ),
  };
  const vendor = {
    print: vi.fn(async () => {
      expect(inTransaction).toBe(false);
      trace.push('vendor:print');
      if (vendorOutcome instanceof Error) throw vendorOutcome;
      return vendorOutcome;
    }),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new PrintJobService(
    dataSource as never,
    vendor as never,
    audit as never,
    () => new Date('2026-08-11T03:04:05.000Z'),
  );
  return {
    service,
    trace,
    batch,
    job,
    printer,
    vendor,
    audit,
    jobRepository,
  };
};

describe('PrintJobService.list', () => {
  it('按 batch/status 分页并映射安全任务视图', async () => {
    const context = setup({
      classification: 'ACCEPTED',
      vendorCode: '0',
      vendorJobId: 'vendor-job-12',
    });

    const result = await context.service.list({
      batchId: '7',
      status: PrintJobStatus.UNKNOWN,
      page: 2,
      pageSize: 20,
    });

    expect(context.jobRepository.findAndCount).toHaveBeenCalledWith({
      where: { batchId: '7', status: PrintJobStatus.UNKNOWN },
      order: { id: 'DESC' },
      skip: 20,
      take: 20,
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: '12',
          batchId: '7',
          orderId: '9',
          status: PrintJobStatus.PENDING,
        }),
      ],
      total: 1,
      page: 2,
      pageSize: 20,
    });
    expect(result.items[0]).not.toHaveProperty('payloadJson');
    expect(result.items[0]).not.toHaveProperty('payloadHash');
  });
});

describe('PrintJobService.submitPendingJob', () => {
  it('在两个短事务之间调用 vendor，并完成 PENDING→SUBMITTING→ACCEPTED', async () => {
    const context = setup({
      classification: 'ACCEPTED',
      vendorCode: '0',
      vendorJobId: 'vendor-job-12',
    });

    const result = await context.service.submitPendingJob(
      '12',
      '1',
      '7',
      'lease-1',
    );

    expect(context.trace).toEqual([
      'db:SUBMITTING',
      'vendor:print',
      'db:ACCEPTED',
    ]);
    expect(result.status).toBe(PrintJobStatus.ACCEPTED);
    expect(result.vendorJobId).toBe('vendor-job-12');
    expect(result.acceptedAt).toEqual(new Date('2026-08-11T03:04:05.000Z'));
    expect(context.vendor.print).toHaveBeenCalledWith({
      serialNumber: 'SN-SECRET-0004',
      content: expect.stringContaining('BM202608110009'),
      tradeOrderId: 'print-job-12',
    });
  });

  it('厂商明确拒绝时分类 FAILED，继续返回稳定 job 而不伪造 accepted', async () => {
    const context = setup({
      classification: 'FAILED',
      vendorCode: '1007',
      vendorJobId: null,
    });

    const result = await context.service.submitPendingJob(
      '12',
      '1',
      '7',
      'lease-1',
    );

    expect(result.status).toBe(PrintJobStatus.FAILED);
    expect(result.vendorErrorCode).toBe('1007');
    expect(result.vendorJobId).toBeNull();
    expect(result.acceptedAt).toBeNull();
  });

  it('厂商异常或不可验证结果 fail closed 为 UNKNOWN', async () => {
    const unknown = Object.assign(new Error('timeout'), {
      classification: 'UNKNOWN',
    });
    const context = setup(unknown);

    const result = await context.service.submitPendingJob(
      '12',
      '1',
      '7',
      'lease-1',
    );

    expect(result.status).toBe(PrintJobStatus.UNKNOWN);
    expect(result.vendorJobId).toBe('print-job-12');
    expect(context.trace).toEqual([
      'db:SUBMITTING',
      'vendor:print',
      'db:UNKNOWN',
    ]);
  });

  it('厂商返回后 lease owner 已变化时拒绝旧 owner 完成', async () => {
    const context = setup({
      classification: 'ACCEPTED',
      vendorCode: '0',
      vendorJobId: 'vendor-job-12',
    });
    context.vendor.print.mockImplementationOnce(async () => {
      context.batch.leaseOwner = 'lease-2';
      return {
        classification: 'ACCEPTED',
        vendorCode: '0',
        vendorJobId: 'vendor-job-12',
      };
    });

    await expect(
      context.service.submitPendingJob('12', '1', '7', 'lease-1'),
    ).rejects.toMatchObject({
      response: { code: 'PRINT_BATCH_LEASE_CONFLICT' },
    });
    expect(context.job.status).toBe(PrintJobStatus.SUBMITTING);
  });

  it.each([
    PrintJobStatus.SUBMITTING,
    PrintJobStatus.UNKNOWN,
    PrintJobStatus.MANUAL_REVIEW,
  ])('拒绝从 %s 普通提交，且不重复 vendor call', async (status) => {
    const context = setup(
      {
        classification: 'ACCEPTED',
        vendorCode: '0',
        vendorJobId: 'must-not-run',
      },
      status,
    );

    await expect(
      context.service.submitPendingJob('12', '1', '7', 'lease-1'),
    ).rejects.toMatchObject({
      response: { code: 'PRINT_JOB_STATUS_CONFLICT' },
    });
    expect(context.vendor.print).not.toHaveBeenCalled();
  });

  it('设备在线缓存过期或非 ACTIVE 时拒绝且 job 保持 PENDING', async () => {
    const context = setup({
      classification: 'ACCEPTED',
      vendorCode: '0',
      vendorJobId: 'must-not-run',
    });
    context.printer.status = CloudPrinterStatus.ERROR;

    await expect(
      context.service.submitPendingJob('12', '1', '7', 'lease-1'),
    ).rejects.toBeDefined();
    expect(context.job.status).toBe(PrintJobStatus.PENDING);
    expect(context.vendor.print).not.toHaveBeenCalled();
  });
});
