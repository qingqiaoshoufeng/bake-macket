import {
  AdminPermission,
  AdminRole,
  PrintJobStatus,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { ADMIN_PERMISSIONS_KEY } from '../auth/admin-permission.decorator.js';
import { AdminPrintJobsController } from './admin-print-jobs.controller.js';

const admin: AuthenticatedAdmin = {
  id: '1',
  username: 'admin@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  mustChangePassword: false,
  permissions: [AdminPermission.PRINT_EXECUTE],
};
const KEY = '11111111-1111-4111-8111-111111111111';

const setup = () => {
  const batches = {
    createSingle: vi.fn(async () => ({ batch: {}, job: {} })),
    create: vi.fn(async () => ({ batch: {} })),
    append: vi.fn(async () => ({ batch: {}, jobs: [] })),
    seal: vi.fn(async () => ({ batch: {} })),
    process: vi.fn(async () => ({
      batch: {},
      processedCount: 0,
      accepted: 0,
      failed: 0,
      unknown: 0,
      manualReview: 0,
    })),
    cancel: vi.fn(async () => ({ batch: {} })),
  };
  const recovery = {
    queryUnknown: vi.fn(async () => ({ batch: {}, job: {} })),
    retryFailed: vi.fn(async () => ({ batch: {}, job: {} })),
    resolveManual: vi.fn(async () => ({ batch: {}, job: {} })),
    resolveManualRetry: vi.fn(async () => ({ batch: {}, job: {} })),
  };
  const jobs = {
    list: vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    })),
  };
  return {
    batches,
    jobs,
    recovery,
    controller: new AdminPrintJobsController(
      batches as never,
      recovery as never,
      jobs as never,
    ),
  };
};

describe('AdminPrintJobsController', () => {
  it.each([
    ['createSingle', [{ orderId: '9', printerId: '4' }]],
    ['createBatch', [{ printerId: '4' }]],
    ['appendBatch', ['7', { orderIds: ['9'] }]],
    ['sealBatch', ['7', {}]],
    ['processBatch', ['7', {}]],
    ['cancelBatch', ['7', {}]],
    ['queryUnknown', ['8', {}]],
    ['retryFailed', ['8', { printerId: '4' }]],
    ['resolveManual', ['8', { resolution: 'CONFIRM_PRINTED' }]],
  ] as const)(
    '%s 缺少 Idempotency-Key 时在调用 service 前拒绝',
    async (method, args) => {
      const { controller, batches, recovery } = setup();

      await expect(
        (controller[method] as (...values: unknown[]) => unknown)(
          admin,
          undefined,
          ...args,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        [...Object.values(batches), ...Object.values(recovery)].every(
          (mock) => !mock.mock.calls.length,
        ),
      ).toBe(true);
    },
  );

  it('转发任务分页筛选且不要求幂等键', async () => {
    const { controller, jobs } = setup();
    const query = {
      batchId: '7',
      status: PrintJobStatus.UNKNOWN,
      page: 2,
      pageSize: 20,
    };

    await controller.list(query);

    expect(jobs.list).toHaveBeenCalledWith(query);
  });

  it('从 header 转发单张打印 key，body 不参与 key', async () => {
    const { controller, batches } = setup();
    const body = { orderId: '9', printerId: '4' };

    await controller.createSingle(admin, KEY, body);

    expect(batches.createSingle).toHaveBeenCalledWith(admin, body, KEY);
    expect(body).not.toHaveProperty('idempotencyKey');
  });

  it('从 header 转发 FAILED retry key 与 printerId', async () => {
    const { controller, recovery } = setup();
    const body = { printerId: '4' };

    await controller.retryFailed(admin, KEY, '8', body);

    expect(recovery.retryFailed).toHaveBeenCalledWith(admin, '8', body, KEY);
  });

  it('逐操作声明 PRINT_EXECUTE permission metadata', () => {
    for (const method of [
      'list',
      'createSingle',
      'createBatch',
      'appendBatch',
      'sealBatch',
      'processBatch',
      'cancelBatch',
      'queryUnknown',
      'retryFailed',
      'resolveManual',
    ] as const) {
      expect(
        Reflect.getMetadata(
          ADMIN_PERMISSIONS_KEY,
          AdminPrintJobsController.prototype[method],
        ),
      ).toEqual([AdminPermission.PRINT_EXECUTE]);
    }
  });
});
