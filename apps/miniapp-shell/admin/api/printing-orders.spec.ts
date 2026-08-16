import {
  AdminRole,
  ManualPrintResolution,
  OPERATOR_PERMISSIONS,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createAdminSessionStore,
  createCustomerSessionStore,
} from '../../utils/admin-session.js';
import { createPrintingOrdersApi } from './printing-orders.js';

const session: AdminSessionView = {
  accessToken: 'admin-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

function app() {
  const adminSession = createAdminSessionStore();
  adminSession.set(session);
  return {
    adminSession,
    customerSession: createCustomerSessionStore(),
  } as never;
}

function requestHarness() {
  const request = vi.fn((options: WechatMiniprogram.RequestOption) => {
    options.success?.({
      statusCode: 200,
      data: {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      },
      header: {},
      cookies: [],
      profile: {} as never,
      exception: {} as never,
      useHttpDNS: false,
      errMsg: 'request:ok',
    });
    return {} as WechatMiniprogram.RequestTask;
  });
  return request;
}

describe('printing orders api', () => {
  it('uses admin audience for orders and printers', async () => {
    const request = requestHarness();
    const api = createPrintingOrdersApi(
      app(),
      request,
      'https://mall.example.com/api/v1',
    );

    await api.listOrders({ page: 1, pageSize: 20 });
    await api.listPrinters({ page: 1, pageSize: 100 });
    await api.getCurrentPrinter();

    expect(request.mock.calls.map(([options]) => options.url)).toEqual([
      'https://mall.example.com/api/v1/admin/orders?page=1&pageSize=20',
      'https://mall.example.com/api/v1/admin/cloud-printers?page=1&pageSize=100',
      'https://mall.example.com/api/v1/admin/cloud-printers/current',
    ]);
    expect(
      request.mock.calls.every(
        ([options]) => options.header?.Authorization === 'Bearer admin-token',
      ),
    ).toBe(true);
  });

  it('reads batch jobs and sends every recovery key only through headers', async () => {
    const request = requestHarness();
    const api = createPrintingOrdersApi(
      app(),
      request,
      'https://mall.example.com/api/v1',
    );
    const key = '123e4567-e89b-42d3-a456-426614174000';

    await api.listJobs({ batchId: '7', page: 1, pageSize: 100 });
    await api.queryUnknown('20', key);
    await api.retryFailed('21', { printerId: '4' }, key);
    await api.resolveManual(
      '22',
      { resolution: ManualPrintResolution.CONFIRM_PRINTED },
      key,
    );

    expect(request.mock.calls.map(([options]) => options.url)).toEqual([
      'https://mall.example.com/api/v1/admin/print-jobs?batchId=7&page=1&pageSize=100',
      'https://mall.example.com/api/v1/admin/print-jobs/20/query-unknown',
      'https://mall.example.com/api/v1/admin/print-jobs/21/retry-failed',
      'https://mall.example.com/api/v1/admin/print-jobs/22/manual-resolution',
    ]);
    expect(
      request.mock.calls
        .slice(1)
        .every(([options]) => options.header?.['Idempotency-Key'] === key),
    ).toBe(true);
    expect(JSON.stringify(request.mock.calls)).not.toContain('idempotencyKey');
  });

  it('sends idempotency keys only through headers for single and batch writes', async () => {
    const request = requestHarness();
    const api = createPrintingOrdersApi(
      app(),
      request,
      'https://mall.example.com/api/v1',
    );
    const key = '123e4567-e89b-42d3-a456-426614174000';

    await api.createSingle({ orderId: '9', printerId: '4' }, key);
    await api.createBatch({ printerId: '4' }, key);

    expect(
      request.mock.calls.every(
        ([options]) => options.header?.['Idempotency-Key'] === key,
      ),
    ).toBe(true);
    expect(JSON.stringify(request.mock.calls)).not.toContain('idempotencyKey');
  });
});
