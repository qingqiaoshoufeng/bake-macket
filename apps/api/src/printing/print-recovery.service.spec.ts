import {
  AdminRole,
  ManualPrintResolution,
  PrintBatchStatus,
  PrintJobStatus,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { PrintBatch } from '../database/entities/print-batch.entity.js';
import { PrintJob } from '../database/entities/print-job.entity.js';
import { PrintRecoveryService } from './print-recovery.service.js';

const admin: AuthenticatedAdmin = {
  id: '1',
  username: 'admin@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  mustChangePassword: false,
  permissions: [],
};
const NOW = new Date('2026-08-12T01:00:00.000Z');

const setup = () => {
  const batch = Object.assign(new PrintBatch(), {
    id: '10',
    printerId: '4',
    createdByAdminId: admin.id,
    status: PrintBatchStatus.PAUSED,
    leaseOwner: null,
    leaseExpiresAt: null,
    totalCount: 1,
    classifiedCount: 0,
    acceptedCount: 0,
    failedCount: 0,
    manualReviewCount: 0,
    manuallyResolvedCount: 0,
    cancelledCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const job: PrintJob = Object.assign(new PrintJob(), {
    id: '20',
    batchId: batch.id,
    orderId: '9',
    printerId: batch.printerId,
    sequence: 1,
    status: PrintJobStatus.UNKNOWN,
    payloadJson: {},
    payloadHash: 'a'.repeat(64),
    payloadRedactedAt: null,
    vendorJobId: null,
    vendorErrorCode: null,
    acceptedAt: null,
    createdByAdminId: admin.id,
    manualResolution: null,
    manualResolutionByAdminId: null,
    manualResolutionAt: null,
    supersedesJobId: null,
    unknownSinceAt: new Date('2026-08-12T00:45:00.000Z'),
    unknownQueryCount: 2,
    lastUnknownQueryAt: new Date('2026-08-12T00:50:00.000Z'),
    createdAt: NOW,
    updatedAt: NOW,
  });
  const batchRepository = {
    findOne: vi.fn(async () => batch),
    save: vi.fn(async (value: PrintBatch) => value),
  };
  const jobRepository = {
    findOne: vi.fn(async () => job),
    find: vi.fn(async () => [job]),
    save: vi.fn(async (value: PrintJob) => value),
  };
  const repositories = new Map<unknown, unknown>([
    [PrintBatch, batchRepository],
    [PrintJob, jobRepository],
  ]);
  const manager = {
    getRepository: vi.fn((entity: unknown) => repositories.get(entity)),
  };
  const dataSource = {
    transaction: vi.fn(async (work: (value: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const idempotency = {
    claim: vi.fn(async () => ({
      kind: 'OWNER' as const,
      owner: {
        id: 'operation-1',
        adminId: admin.id,
        operation: 'PRINT_JOB_QUERY_UNKNOWN',
        key: '11111111-1111-4111-8111-111111111111',
        requestHash: 'hash',
      },
    })),
    complete: vi.fn(async () => undefined),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const vendor = { queryOrder: vi.fn() };
  const service = new PrintRecoveryService(
    dataSource as never,
    idempotency as never,
    audit as never,
    vendor as never,
    () => NOW,
  );
  return { service, batch, job, idempotency, vendor };
};

describe('PrintRecoveryService UNKNOWN 查询', () => {
  it('可信 tradeOrderId 可查询并将 UNKNOWN 收敛为 ACCEPTED', async () => {
    const context = setup();
    context.job.vendorJobId = 'print-job-20';
    context.job.unknownQueryCount = 0;
    context.vendor.queryOrder.mockResolvedValue({
      printed: true,
      vendorCode: '0',
    });

    const result = await context.service.queryUnknown(
      admin,
      context.job.id,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(context.vendor.queryOrder).toHaveBeenCalledWith('print-job-20');
    expect(result.job).toMatchObject({
      id: '20',
      status: PrintJobStatus.ACCEPTED,
      vendorJobId: 'print-job-20',
    });
  });

  it('没有可信厂商任务号时绝不重发，第三次查询转 MANUAL_REVIEW', async () => {
    const context = setup();

    const result = await context.service.queryUnknown(
      admin,
      context.job.id,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(context.vendor.queryOrder).not.toHaveBeenCalled();
    expect(context.job).toMatchObject({
      status: PrintJobStatus.MANUAL_REVIEW,
      unknownQueryCount: 3,
      lastUnknownQueryAt: NOW,
    });
    expect(result).toMatchObject({
      job: { id: '20', status: PrintJobStatus.MANUAL_REVIEW },
      batch: {
        id: '10',
        status: PrintBatchStatus.PAUSED,
        manualReviewCount: 1,
        classifiedCount: 0,
      },
    });
    expect(context.idempotency.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resourceType: 'PRINT_JOB',
        resourceId: '20',
        responseSnapshot: result,
      }),
    );
  });
});

describe('PrintRecoveryService 人工处置', () => {
  it.each([
    {
      resolution: ManualPrintResolution.CONFIRM_PRINTED,
      expectedStatus: PrintJobStatus.MANUALLY_CONFIRMED_PRINTED,
    },
    {
      resolution: ManualPrintResolution.CONFIRM_NOT_PRINTED,
      expectedStatus: PrintJobStatus.FAILED,
    },
  ])('$resolution 只收敛原 job 并完成含问题批次', async ({
    resolution,
    expectedStatus,
  }) => {
    const context = setup();
    context.job.status = PrintJobStatus.MANUAL_REVIEW;
    context.job.unknownQueryCount = 3;

    const result = await context.service.resolveManual(
      admin,
      context.job.id,
      { resolution } as Exclude<
        import('@bake-mall/contracts').ManualPrintResolutionRequest,
        { resolution: ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK }
      >,
      '22222222-2222-4222-8222-222222222222',
    );

    expect(result).toMatchObject({
      resolution,
      job: {
        id: '20',
        status: expectedStatus,
        manualResolution: resolution,
        manualResolutionByAdminId: admin.id,
        manualResolutionAt: NOW.toISOString(),
      },
      batch: {
        status: PrintBatchStatus.COMPLETED_WITH_ISSUES,
        classifiedCount: 1,
        manuallyResolvedCount:
          resolution === ManualPrintResolution.CONFIRM_PRINTED ? 1 : 0,
        failedCount:
          resolution === ManualPrintResolution.CONFIRM_NOT_PRINTED ? 1 : 0,
      },
    });
  });
});
