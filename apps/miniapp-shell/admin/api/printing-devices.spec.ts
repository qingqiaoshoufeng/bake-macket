import {
  AdminRole,
  ApiErrorCode,
  OPERATOR_PERMISSIONS,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type AdminSessionView,
  type BindCloudPrinterRequest,
  type CloudPrinterView,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { BakeMallAppData } from '../../app.js';
import {
  createAdminSessionStore,
  createCustomerSessionStore,
} from '../../utils/admin-session.js';
import { createPrintingDevicesController } from '../hooks/printing-devices.js';
import { createPrintingDevicesApi } from './printing-devices.js';

const key = '123e4567-e89b-42d3-a456-426614174000';
const nextKey = '223e4567-e89b-42d3-a456-426614174001';
const activePrinter: CloudPrinterView = {
  id: '1001',
  displayName: '前台出单机',
  serialNumberMasked: 'SN****01',
  status: CloudPrinterStatus.ACTIVE,
  onlineStatus: CloudPrinterOnlineStatus.ONLINE,
  lastStatusCheckedAt: '2026-08-09T10:00:00.000Z',
  bindingStage: PrinterBindingStage.NONE,
  vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
};

function appData(): BakeMallAppData {
  const adminSession = createAdminSessionStore();
  const customerSession = createCustomerSessionStore();
  adminSession.set({
    accessToken: `header.${Buffer.from(
      JSON.stringify({ sub: '42', aud: 'mall-admin' }),
    ).toString('base64url')}.signature`,
    expiresAt: '2099-01-01T00:00:00.000Z',
    role: AdminRole.OPERATOR,
    permissions: OPERATOR_PERMISSIONS,
    mustChangePassword: false,
  } as AdminSessionView);
  return {
    adminSession,
    customerSession,
    phoneCredentialHandoff: {
      clear: vi.fn(),
      consume: vi.fn(),
      put: vi.fn(),
    },
  } as unknown as BakeMallAppData;
}

type RequestCall = WechatMiniprogram.RequestOption & {
  success: NonNullable<WechatMiniprogram.RequestOption['success']>;
};

function unauthorizedResponse(): WechatMiniprogram.RequestSuccessCallbackResult {
  return {
    data: { message: 'unauthorized' },
    statusCode: 401,
    header: {},
    cookies: [],
    profile: undefined,
  } as never;
}

function controllerStorage() {
  return {
    get: vi.fn(() => undefined),
    remove: vi.fn(),
    set: vi.fn(),
  };
}

function requestHarness() {
  const calls: RequestCall[] = [];
  const request = vi.fn((options: WechatMiniprogram.RequestOption) => {
    calls.push(options as RequestCall);
    options.success?.({
      data: {},
      statusCode: 200,
      header: {},
      cookies: [],
      profile: undefined,
    } as never);
    return {} as WechatMiniprogram.RequestTask;
  });
  return { calls, request };
}

describe('createPrintingDevicesApi', () => {
  it('composes the list route and preserves numeric printer IDs as strings', async () => {
    const harness = requestHarness();
    const api = createPrintingDevicesApi(
      appData(),
      harness.request,
      'https://mall.example.com/api/v1',
    );

    await api.list({ page: 2, pageSize: 50, includeUnbound: true });
    await api.refresh('90071992547409931234', {}, key);
    await api.unbind(
      '90071992547409931234',
      { operationPassword: 'secret' },
      key,
    );

    expect(harness.calls.map(({ url }) => url)).toEqual([
      'https://mall.example.com/api/v1/admin/cloud-printers?page=2&pageSize=50&includeUnbound=true',
      'https://mall.example.com/api/v1/admin/cloud-printers/90071992547409931234/online-status/refresh',
      'https://mall.example.com/api/v1/admin/cloud-printers/90071992547409931234/unbind',
    ]);
  });

  it('reuses the actual refresh request header and storage key until stable convergence', async () => {
    const app = appData();
    const calls: RequestCall[] = [];
    const responses = [
      {
        statusCode: 409,
        data: {
          code: ApiErrorCode.IDEMPOTENCY_RESULT_UNKNOWN,
          message: '结果未知',
        },
      },
      { statusCode: 200, data: { printer: activePrinter } },
      {
        statusCode: 200,
        data: { items: [activePrinter], total: 1, page: 1, pageSize: 20 },
      },
      { statusCode: 200, data: { printer: activePrinter } },
      {
        statusCode: 200,
        data: { items: [activePrinter], total: 1, page: 1, pageSize: 20 },
      },
    ] as const;
    const request = vi.fn((options: WechatMiniprogram.RequestOption) => {
      const response = responses[calls.length]!;
      calls.push(options as RequestCall);
      options.success?.({
        ...response,
        header: {},
        cookies: [],
        profile: undefined,
      } as never);
      return {} as WechatMiniprogram.RequestTask;
    });
    const values = new Map<string, unknown>();
    const storage = {
      get: (storageKey: string) => values.get(storageKey),
      remove: (storageKey: string) => values.delete(storageKey),
      set: (storageKey: string, value: unknown) =>
        values.set(storageKey, value),
    };
    const randomUUID = vi
      .fn<() => string>()
      .mockReturnValueOnce(key)
      .mockReturnValueOnce(nextKey);
    const controller = createPrintingDevicesController({
      adminSession: app.adminSession,
      api: createPrintingDevicesApi(app, request),
      randomUUID,
      storage,
    });

    await expect(
      controller.refreshOnlineStatus(activePrinter.id),
    ).rejects.toThrow('结果未知');
    expect(values.values().next().value).toMatchObject({
      pendingDeviceOperations: [{ idempotencyKey: key }],
    });

    await controller.refreshOnlineStatus(activePrinter.id);
    expect(
      calls
        .slice(0, 2)
        .map(
          ({ header }) => (header as Record<string, string>)['Idempotency-Key'],
        ),
    ).toEqual([key, key]);
    expect(values.values().next().value).toMatchObject({
      pendingDeviceOperations: [],
    });

    await controller.refreshOnlineStatus(activePrinter.id);
    expect(
      (calls[3]!.header as Record<string, string>)['Idempotency-Key'],
    ).toBe(nextKey);
  });

  it.each(['load', 'operation'] as const)(
    'keeps the newer admin session when a real client %s request later returns 401',
    async (requestKind) => {
      const app = appData();
      let respondUnauthorized!: () => void;
      const request = vi.fn((options: WechatMiniprogram.RequestOption) => {
        if (request.mock.calls.length === 1) {
          respondUnauthorized = () => options.success?.(unauthorizedResponse());
        } else {
          options.success?.({
            data: { items: [activePrinter], total: 1, page: 1, pageSize: 20 },
            statusCode: 200,
            header: {},
            cookies: [],
            profile: undefined,
          } as never);
        }
        return {} as WechatMiniprogram.RequestTask;
      });
      const controller = createPrintingDevicesController({
        adminSession: app.adminSession,
        api: createPrintingDevicesApi(app, request),
        randomUUID: () => key,
        storage: controllerStorage(),
      });
      const pending =
        requestKind === 'load'
          ? controller.load()
          : controller.refreshOnlineStatus(activePrinter.id);
      await vi.waitFor(() => expect(request).toHaveBeenCalled());
      const newerSession = {
        ...app.adminSession.get()!,
        accessToken: 'header.newer.signature',
      };
      app.adminSession.set(newerSession);

      respondUnauthorized();
      await expect(pending).rejects.toMatchObject({ status: 401 });
      expect(app.adminSession.get()).toEqual(newerSession);
    },
  );

  it('clears the same admin token through the real client on 401 so the page can redirect', async () => {
    const app = appData();
    const request = vi.fn((options: WechatMiniprogram.RequestOption) => {
      options.success?.(unauthorizedResponse());
      return {} as WechatMiniprogram.RequestTask;
    });
    const controller = createPrintingDevicesController({
      adminSession: app.adminSession,
      api: createPrintingDevicesApi(app, request),
      storage: controllerStorage(),
    });

    await expect(controller.load()).rejects.toMatchObject({ status: 401 });
    expect(app.adminSession.get()).toBeNull();
  });

  it('sends every write DTO unchanged with Idempotency-Key', async () => {
    const harness = requestHarness();
    const api = createPrintingDevicesApi(appData(), harness.request);
    const bind: BindCloudPrinterRequest = {
      serialNumber: 'SN-1001',
      displayName: '前台出单机',
      operationPassword: 'secret',
    };

    await api.bind(bind, key);
    await api.confirm(
      '1001',
      { challengeId: 'c-1', code: '123456', operationPassword: 'secret' },
      key,
    );
    await api.resend('1001', { operationPassword: 'secret' }, key);
    await api.refresh('1001', {}, key);
    await api.requery('1001', { operationPassword: 'secret' }, key);
    await api.confirmDeletion('1001', { operationPassword: 'secret' }, key);
    await api.rename('1001', { displayName: '新名字' }, key);

    expect(harness.calls.map(({ method }) => method)).toEqual([
      'POST',
      'POST',
      'POST',
      'POST',
      'POST',
      'POST',
      'PATCH',
    ]);
    expect(
      harness.calls.every(
        ({ header }) =>
          (header as Record<string, string>)['Idempotency-Key'] === key,
      ),
    ).toBe(true);
    expect(harness.calls.map(({ data }) => data)).toEqual([
      bind,
      { challengeId: 'c-1', code: '123456', operationPassword: 'secret' },
      { operationPassword: 'secret' },
      {},
      { operationPassword: 'secret' },
      { operationPassword: 'secret' },
      { displayName: '新名字' },
    ]);
  });
});
