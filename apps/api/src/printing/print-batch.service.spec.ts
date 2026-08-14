import {
  AdminRole,
  CloudPrinterStatus,
  FulfillmentType,
  OrderStatus,
  PrintBatchStatus,
  PrintJobStatus,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CloudPrinter } from '../database/entities/cloud-printer.entity.js';
import { OrderItem } from '../database/entities/order-item.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { PrintBatch } from '../database/entities/print-batch.entity.js';
import { PrintJob } from '../database/entities/print-job.entity.js';
import {
  CreatePrintBatchDto,
  CreateSinglePrintDto,
} from './dto/print-job.dto.js';
import { PrintBatchService } from './print-batch.service.js';

const admin: AuthenticatedAdmin = {
  id: '1',
  username: 'admin@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  mustChangePassword: false,
  permissions: [],
};
const KEY = '11111111-1111-4111-8111-111111111111';

const setup = () => {
  let batchSequence = 0;
  let jobSequence = 0;
  const batches: PrintBatch[] = [];
  const jobs: PrintJob[] = [];
  const printer = Object.assign(new CloudPrinter(), {
    id: '4',
    status: CloudPrinterStatus.ACTIVE,
  });
  const order = Object.assign(new Order(), {
    id: '9',
    orderNo: 'BM9',
    status: OrderStatus.NEW,
    fulfillmentType: FulfillmentType.PICKUP,
    contactName: '林女士',
    contactPhone: '13800000000',
    pickupTimeText: null,
    deliveryAddressText: null,
    goodsTotalCents: 1_000,
    membershipDiscountCents: 0,
    creditAppliedCents: 0,
    payableTotalCents: 1_000,
    membershipCode: null,
    membershipName: null,
    membershipDiscountBasisPoints: null,
    pricingVersion: 1,
    remark: null,
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
  });
  const item = Object.assign(new OrderItem(), {
    id: '11',
    orderId: order.id,
    productId: '2',
    skuId: '3',
    productName: '蛋糕',
    skuName: '六寸',
    skuAttributes: { size: '六寸' },
    imageUrl: null,
    unitPriceCents: 1_000,
    quantity: 1,
    lineGoodsTotalCents: 1_000,
    lineMembershipDiscountCents: 0,
    linePayableCents: 1_000,
  });
  const batchRepository = {
    create: vi.fn((value: Partial<PrintBatch>) =>
      Object.assign(new PrintBatch(), value),
    ),
    save: vi.fn(async (value: PrintBatch) => {
      if (!value.id) {
        value.id = String(++batchSequence);
        value.createdAt = new Date('2026-08-11T01:00:00.000Z');
      }
      value.updatedAt = new Date('2026-08-11T01:00:00.000Z');
      if (!batches.includes(value)) batches.push(value);
      return value;
    }),
    findOne: vi.fn(async ({ where }: { where: { id?: string } }) =>
      where.id ? (batches.find(({ id }) => id === where.id) ?? null) : null,
    ),
  };
  const jobRepository = {
    create: vi.fn((value: Partial<PrintJob>) =>
      Object.assign(new PrintJob(), value),
    ),
    save: vi.fn(async (values: PrintJob | PrintJob[]) => {
      const list = Array.isArray(values) ? values : [values];
      for (const value of list) {
        if (!value.id) {
          value.id = String(++jobSequence);
          value.createdAt = new Date('2026-08-11T01:00:00.000Z');
        }
        value.updatedAt = new Date('2026-08-11T01:00:00.000Z');
        if (!jobs.includes(value)) jobs.push(value);
      }
      return values;
    }),
    find: vi.fn(async ({ where }: { where: { batchId?: string } }) =>
      where.batchId
        ? jobs.filter(({ batchId }) => batchId === where.batchId)
        : jobs,
    ),
    findOne: vi.fn(
      async ({ where }: { where: { orderId?: string } }) =>
        jobs
          .filter(({ orderId }) => orderId === where.orderId)
          .sort((left, right) => right.sequence - left.sequence)[0] ?? null,
    ),
  };
  const repositories = new Map<unknown, unknown>([
    [PrintBatch, batchRepository],
    [PrintJob, jobRepository],
    [CloudPrinter, { findOne: vi.fn(async () => printer) }],
    [Order, { find: vi.fn(async () => [order]) }],
    [OrderItem, { find: vi.fn(async () => [item]) }],
  ]);
  const manager = {
    getRepository: vi.fn((entity: unknown) => repositories.get(entity)),
  };
  const dataSource = {
    transaction: vi.fn(async (work: (value: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  type ClaimResult =
    | {
        kind: 'OWNER';
        owner: {
          id: string;
          adminId: string;
          operation: string;
          key: string;
          requestHash: string;
        };
      }
    | {
        kind: 'REPLAY';
        status: 'COMPLETED' | 'FAILED';
        resourceType: string | null;
        resourceId: string | null;
        responseSnapshot: Record<string, unknown> | null;
      };
  const idempotency = {
    claim: vi.fn(
      async (...args: [unknown, { request: unknown }]): Promise<ClaimResult> => {
        void args;
        return {
          kind: 'OWNER',
          owner: {
            id: 'operation-1',
            adminId: admin.id,
            operation: 'PRINT_BATCH_CREATE',
            key: KEY,
            requestHash: 'hash',
          },
        };
      },
    ),
    complete: vi.fn(async () => undefined),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const printJobs = { submitPendingJob: vi.fn() };
  const recovery = { recoverSubmittingJobs: vi.fn(async () => undefined) };
  const service = new PrintBatchService(
    dataSource as never,
    idempotency as never,
    audit as never,
    printJobs as never,
    recovery as never,
    () => new Date('2026-08-11T01:00:00.000Z'),
  );
  return {
    service,
    printer,
    order,
    batches,
    jobs,
    batchRepository,
    jobRepository,
    idempotency,
    printJobs,
    recovery,
  };
};

describe('PrintBatchService 构建批次', () => {
  it('create 幂等创建一个 DRAFT 空批次并保存稳定 snapshot', async () => {
    const context = setup();

    const request = Object.assign(new CreatePrintBatchDto(), {
      printerId: '4',
    });
    const result = await context.service.create(admin, request, KEY);

    expect(result.batch).toMatchObject({
      id: '1',
      printerId: '4',
      status: PrintBatchStatus.DRAFT,
      totalCount: 0,
      pendingCount: 0,
    });
    expect(context.batches).toHaveLength(1);
    expect(context.idempotency.claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: 'PRINT_BATCH_CREATE',
        request: { printerId: '4' },
      }),
    );
    const createClaimRequest = context.idempotency.claim.mock.calls[0]![1]
      .request as object;
    expect(Object.getPrototypeOf(createClaimRequest)).toBe(Object.prototype);
    expect(context.idempotency.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resourceType: 'PRINT_BATCH',
        resourceId: '1',
        responseSnapshot: result,
      }),
    );
  });

  it('create replay 直接返回 snapshot 且不重复保存', async () => {
    const context = setup();
    const snapshot = {
      batch: {
        id: '88',
        printerId: '4',
        createdByAdminId: '1',
        status: PrintBatchStatus.DRAFT,
        leaseOwner: null,
        leaseExpiresAt: null,
        totalCount: 0,
        classifiedCount: 0,
        pendingCount: 0,
        submittingCount: 0,
        acceptedCount: 0,
        failedCount: 0,
        unknownCount: 0,
        manualReviewCount: 0,
        manuallyResolvedCount: 0,
        cancelledCount: 0,
        createdAt: '2026-08-11T01:00:00.000Z',
        updatedAt: '2026-08-11T01:00:00.000Z',
      },
    };
    context.idempotency.claim.mockResolvedValueOnce({
      kind: 'REPLAY',
      status: 'COMPLETED',
      resourceType: 'PRINT_BATCH',
      resourceId: '88',
      responseSnapshot: snapshot,
    });

    await expect(
      context.service.create(admin, { printerId: '4' }, KEY),
    ).resolves.toEqual(snapshot);
    expect(context.batchRepository.save).not.toHaveBeenCalled();
  });

  it('append 原子创建 payload/job、同 chunk 去重并更新总数', async () => {
    const context = setup();
    const created = await context.service.create(
      admin,
      { printerId: '4' },
      KEY,
    );
    context.idempotency.claim.mockResolvedValueOnce({
      kind: 'OWNER',
      owner: {
        id: 'operation-2',
        adminId: admin.id,
        operation: 'PRINT_BATCH_APPEND',
        key: '22222222-2222-4222-8222-222222222222',
        requestHash: 'hash-2',
      },
    });

    const result = await context.service.append(
      admin,
      created.batch.id,
      { orderIds: ['9', '9'] },
      '22222222-2222-4222-8222-222222222222',
    );

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      batchId: '1',
      orderId: '9',
      printerId: '4',
      sequence: 1,
      status: PrintJobStatus.PENDING,
    });
    expect(context.jobs[0]?.payloadJson).toMatchObject({
      order: { id: '9', orderNo: 'BM9' },
      customer: { phoneMasked: '138****0000' },
    });
    expect(context.jobs[0]?.payloadHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.batch.totalCount).toBe(1);
    expect(result.batch.pendingCount).toBe(1);
  });

  it('append 超过 100 个传输上限时拒绝且不创建 job', async () => {
    const context = setup();
    const created = await context.service.create(
      admin,
      { printerId: '4' },
      KEY,
    );

    await expect(
      context.service.append(
        admin,
        created.batch.id,
        {
          orderIds: Array.from({ length: 101 }, (_, index) =>
            String(index + 1),
          ),
        },
        '22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toMatchObject({
      response: { code: 'PRINT_BATCH_APPEND_LIMIT_EXCEEDED' },
    });
    expect(context.jobRepository.save).not.toHaveBeenCalled();
  });

  it('seal 仅允许非空 DRAFT，并转为 READY 后禁止继续 append', async () => {
    const context = setup();
    const created = await context.service.create(
      admin,
      { printerId: '4' },
      KEY,
    );
    await context.service.append(
      admin,
      created.batch.id,
      { orderIds: ['9'] },
      '22222222-2222-4222-8222-222222222222',
    );

    const sealed = await context.service.seal(
      admin,
      created.batch.id,
      '33333333-3333-4333-8333-333333333333',
    );

    expect(sealed.batch.status).toBe(PrintBatchStatus.READY);
    await expect(
      context.service.append(
        admin,
        created.batch.id,
        { orderIds: ['9'] },
        '44444444-4444-4444-8444-444444444444',
      ),
    ).rejects.toMatchObject({
      response: { code: 'PRINT_BATCH_STATUS_CONFLICT' },
    });
  });
});

describe('PrintBatchService 单张打印', () => {
  it('一个 PRINT_SINGLE_CREATE key 原子创建 READY 一项 batch/job 后复用 process', async () => {
    const context = setup();
    let statusBeforeProcess: PrintJobStatus | undefined;
    const processSpy = vi
      .spyOn(context.service, 'process')
      .mockImplementation(async () => {
        statusBeforeProcess = context.jobs[0]!.status;
        context.jobs[0]!.status = PrintJobStatus.ACCEPTED;
        return {
          batch: {
            id: '1',
            printerId: '4',
            createdByAdminId: '1',
            status: PrintBatchStatus.COMPLETED,
            leaseOwner: null,
            leaseExpiresAt: null,
            totalCount: 1,
            classifiedCount: 1,
            pendingCount: 0,
            submittingCount: 0,
            acceptedCount: 1,
            failedCount: 0,
            unknownCount: 0,
            manualReviewCount: 0,
            manuallyResolvedCount: 0,
            cancelledCount: 0,
            createdAt: '2026-08-11T01:00:00.000Z',
            updatedAt: '2026-08-11T01:00:00.000Z',
          },
          processedCount: 1,
          accepted: 1,
          failed: 0,
          unknown: 0,
          manualReview: 0,
        };
      });

    const request = Object.assign(new CreateSinglePrintDto(), {
      orderId: '9',
      printerId: '4',
    });
    const result = await context.service.createSingle(
      admin,
      request,
      '66666666-6666-4666-8666-666666666666',
    );

    expect(context.idempotency.claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: 'PRINT_SINGLE_CREATE',
        request: { orderId: '9', printerId: '4' },
      }),
    );
    const singleClaimRequest = context.idempotency.claim.mock.calls[0]![1]
      .request as object;
    expect(Object.getPrototypeOf(singleClaimRequest)).toBe(Object.prototype);
    expect(context.batches[0]).toMatchObject({
      status: PrintBatchStatus.READY,
      totalCount: 1,
    });
    expect(context.jobs[0]).toMatchObject({
      batchId: '1',
      orderId: '9',
    });
    expect(statusBeforeProcess).toBe(PrintJobStatus.PENDING);
    expect(processSpy).toHaveBeenCalledWith(
      admin,
      '1',
      '66666666-6666-4666-8666-666666666666',
      'PRINT_SINGLE_PROCESS',
    );
    expect(result).toEqual({
      batch: expect.objectContaining({
        id: '1',
        status: PrintBatchStatus.COMPLETED,
      }),
      job: expect.objectContaining({
        id: '1',
        status: PrintJobStatus.ACCEPTED,
      }),
    });
  });
});

const readyBatch = async (context: ReturnType<typeof setup>) => {
  const created = await context.service.create(
    admin,
    { printerId: '4' },
    KEY,
  );
  await context.service.append(
    admin,
    created.batch.id,
    { orderIds: ['9'] },
    '22222222-2222-4222-8222-222222222222',
  );
  await context.service.seal(
    admin,
    created.batch.id,
    '33333333-3333-4333-8333-333333333333',
  );
  return context.batches[0]!;
};

describe('PrintBatchService 取消批次', () => {
  it('仅取消 PENDING job，并保留已经分类的结果', async () => {
    const context = setup();
    const batch = await readyBatch(context);
    context.jobs.push(
      Object.assign(new PrintJob(), {
        ...context.jobs[0]!,
        id: '2',
        orderId: '10',
        status: PrintJobStatus.ACCEPTED,
        vendorJobId: 'vendor-2',
      }),
    );
    batch.totalCount = 2;

    const result = await context.service.cancel(
      admin,
      batch.id,
      '77777777-7777-4777-8777-777777777777',
    );

    expect(context.jobs.map(({ status }) => status)).toEqual([
      PrintJobStatus.CANCELLED,
      PrintJobStatus.ACCEPTED,
    ]);
    expect(result.batch).toMatchObject({
      status: PrintBatchStatus.CANCELLED,
      totalCount: 2,
      classifiedCount: 2,
      acceptedCount: 1,
      cancelledCount: 1,
      pendingCount: 0,
    });
    expect(context.idempotency.claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: 'PRINT_BATCH_CANCEL',
        request: { batchId: batch.id },
      }),
    );
  });

  it.each([
    PrintJobStatus.SUBMITTING,
    PrintJobStatus.UNKNOWN,
    PrintJobStatus.MANUAL_REVIEW,
  ])('存在未收敛的 %s job 时整批拒绝且不部分取消', async (status) => {
    const context = setup();
    const batch = await readyBatch(context);
    context.jobs.push(
      Object.assign(new PrintJob(), {
        ...context.jobs[0]!,
        id: '2',
        orderId: '10',
        status,
      }),
    );
    batch.totalCount = 2;

    await expect(
      context.service.cancel(
        admin,
        batch.id,
        '77777777-7777-4777-8777-777777777777',
      ),
    ).rejects.toMatchObject({
      response: { code: 'PRINT_BATCH_STATUS_CONFLICT' },
    });
    expect(context.jobs[0]!.status).toBe(PrintJobStatus.PENDING);
  });
});

describe('PrintBatchService process', () => {
  const readyBatch = async (context: ReturnType<typeof setup>) => {
    const created = await context.service.create(
      admin,
      { printerId: '4' },
      KEY,
    );
    await context.service.append(
      admin,
      created.batch.id,
      { orderIds: ['9'] },
      '22222222-2222-4222-8222-222222222222',
    );
    await context.service.seal(
      admin,
      created.batch.id,
      '33333333-3333-4333-8333-333333333333',
    );
    return context.batches[0]!;
  };

  it('过期 RUNNING lease 只收敛 SUBMITTING 并暂停，不消费 PENDING', async () => {
    const context = setup();
    const batch = await readyBatch(context);
    batch.status = PrintBatchStatus.RUNNING;
    batch.leaseOwner = 'stale-owner';
    batch.leaseExpiresAt = new Date('2026-08-11T00:59:59.000Z');
    context.jobs[0]!.status = PrintJobStatus.SUBMITTING;
    context.jobs.push(
      Object.assign(new PrintJob(), {
        ...context.jobs[0]!,
        id: '2',
        orderId: '10',
        status: PrintJobStatus.PENDING,
      }),
    );

    const result = await context.service.process(
      admin,
      batch.id,
      '55555555-5555-4555-8555-555555555555',
    );

    expect(context.recovery.recoverSubmittingJobs).toHaveBeenCalledWith(
      batch.id,
      admin.id,
    );
    expect(context.printJobs.submitPendingJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      processedCount: 0,
      batch: { status: PrintBatchStatus.PAUSED, pendingCount: 1 },
    });
  });

  it('持有 60 秒 lease，处理 PENDING 后无问题完成并释放 lease', async () => {
    const context = setup();
    const batch = await readyBatch(context);
    context.printJobs.submitPendingJob.mockImplementation(
      async (jobId: string) => {
        const job = context.jobs.find(({ id }) => id === jobId)!;
        job.status = PrintJobStatus.ACCEPTED;
        job.vendorJobId = `vendor-${jobId}`;
        return job;
      },
    );

    const result = await context.service.process(
      admin,
      batch.id,
      '55555555-5555-4555-8555-555555555555',
    );

    expect(context.printJobs.submitPendingJob).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      processedCount: 1,
      accepted: 1,
      failed: 0,
      unknown: 0,
      manualReview: 0,
      batch: {
        status: PrintBatchStatus.COMPLETED,
        acceptedCount: 1,
        classifiedCount: 1,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  });

  it('每次最多 20 项，剩余 PENDING 时转 PAUSED', async () => {
    const context = setup();
    const batch = await readyBatch(context);
    const template = context.jobs[0]!;
    for (let index = 2; index <= 25; index += 1) {
      context.jobs.push(
        Object.assign(new PrintJob(), {
          ...template,
          id: String(index),
          orderId: String(index + 100),
          sequence: index,
          status: PrintJobStatus.PENDING,
        }),
      );
    }
    batch.totalCount = 25;
    context.printJobs.submitPendingJob.mockImplementation(
      async (jobId: string) => {
        const job = context.jobs.find(({ id }) => id === jobId)!;
        job.status = PrintJobStatus.ACCEPTED;
        return job;
      },
    );

    const result = await context.service.process(
      admin,
      batch.id,
      '55555555-5555-4555-8555-555555555555',
    );

    expect(context.printJobs.submitPendingJob).toHaveBeenCalledTimes(20);
    expect(result.processedCount).toBe(20);
    expect(result.batch.status).toBe(PrintBatchStatus.PAUSED);
    expect(result.batch.pendingCount).toBe(5);
  });

  it.each([
    {
      firstStatus: PrintJobStatus.UNKNOWN,
      expectedBatchStatus: PrintBatchStatus.PAUSED,
      expectedUnknown: 1,
      expectedFailed: 0,
    },
    {
      firstStatus: PrintJobStatus.FAILED,
      expectedBatchStatus: PrintBatchStatus.COMPLETED_WITH_ISSUES,
      expectedUnknown: 0,
      expectedFailed: 1,
    },
  ])(
    '单项 $firstStatus 不阻止后续项，并严格重算为 $expectedBatchStatus',
    async ({
      firstStatus,
      expectedBatchStatus,
      expectedUnknown,
      expectedFailed,
    }) => {
      const context = setup();
      const batch = await readyBatch(context);
      const second = Object.assign(new PrintJob(), {
        ...context.jobs[0]!,
        id: '2',
        orderId: '10',
        sequence: 1,
        status: PrintJobStatus.PENDING,
      });
      context.jobs.push(second);
      batch.totalCount = 2;
      context.printJobs.submitPendingJob.mockImplementation(
        async (jobId: string) => {
          const job = context.jobs.find(({ id }) => id === jobId)!;
          job.status = jobId === '1' ? firstStatus : PrintJobStatus.ACCEPTED;
          return job;
        },
      );

      const result = await context.service.process(
        admin,
        batch.id,
        '55555555-5555-4555-8555-555555555555',
      );

      expect(context.printJobs.submitPendingJob).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        processedCount: 2,
        accepted: 1,
        failed: expectedFailed,
        unknown: expectedUnknown,
        batch: {
          status: expectedBatchStatus,
          acceptedCount: 1,
          failedCount: expectedFailed,
          unknownCount: expectedUnknown,
        },
      });
    },
  );
});
