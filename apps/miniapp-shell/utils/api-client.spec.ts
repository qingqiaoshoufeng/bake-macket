import {
  AdminPermission,
  AdminRole,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiClientError,
  createMiniappApiClient,
  MINIAPP_API_REQUEST_TIMEOUT_MS,
} from './api-client.js';
import {
  createAdminSessionStore,
  createCustomerSessionStore,
} from './admin-session.js';

const adminSession: AdminSessionView = {
  accessToken: 'admin-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: [
    AdminPermission.ORDER_READ,
    AdminPermission.ORDER_STATUS_UPDATE,
    AdminPermission.USER_READ,
    AdminPermission.USER_CREATE,
    AdminPermission.PRINT_DEVICE_MANAGE,
    AdminPermission.PRINT_EXECUTE,
    AdminPermission.PRINT_HISTORY_READ,
    AdminPermission.SELF_PASSWORD_CHANGE,
  ],
  mustChangePassword: false,
};

const customerSession = {
  accessToken: 'customer-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  profile: { id: '42', phoneVerified: false },
};

type RequestOptions = WechatMiniprogram.RequestOption;

function createRequestMock() {
  return vi.fn((options: RequestOptions) => {
    options.success?.({
      data: { ok: true },
      statusCode: 200,
      header: { 'content-type': 'application/json' },
      cookies: [],
      profile: {} as WechatMiniprogram.RequestProfile,
      exception: { reasons: [], retryCount: 0 },
      useHttpDNS: false,
      errMsg: 'request:ok',
    });
    return {} as WechatMiniprogram.RequestTask;
  });
}

function createClient(request = createRequestMock()) {
  const customer = createCustomerSessionStore();
  const admin = createAdminSessionStore();
  customer.set(customerSession);
  admin.set(adminSession);
  const client = createMiniappApiClient({
    baseUrl: 'https://mall.example.com/api/v1',
    request,
    customerSession: customer,
    adminSession: admin,
  });
  return { admin, client, customer, request };
}

describe('miniapp API client', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends mall-admin only to same-origin /api/v1 admin paths', async () => {
    const { client, request } = createClient();

    await expect(
      client.get('/admin/users', { audience: 'admin' }),
    ).resolves.toEqual({ ok: true });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://mall.example.com/api/v1/admin/users',
        method: 'GET',
        timeout: MINIAPP_API_REQUEST_TIMEOUT_MS,
        header: { Authorization: 'Bearer admin-token' },
      }),
    );
  });

  it('keeps customer and admin bearer tokens separated', async () => {
    const { client, request } = createClient();

    await client.post(
      '/auth/wechat/phone',
      { code: 'phone-code' },
      {
        audience: 'customer',
      },
    );
    await client.get('/admin/users', { audience: 'admin' });

    expect(request.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        header: expect.objectContaining({
          Authorization: 'Bearer customer-token',
        }),
      }),
    );
    expect(request.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        header: expect.objectContaining({
          Authorization: 'Bearer admin-token',
        }),
      }),
    );
  });

  it.each([
    ['admin', '/users'],
    ['admin', '/auth/wechat/login'],
    ['customer', '/admin/users'],
    ['customer', '/orders?accessToken=secret'],
    ['customer', '/orders#token=secret'],
    ['customer', 'https://evil.example/api/v1/orders'],
    ['customer', '//evil.example/api/v1/orders'],
    ['customer', 'https://user@evil.example/api/v1/orders'],
  ] as const)(
    'rejects unsafe %s audience path %s before wx.request',
    async (audience, path) => {
      const { client, request } = createClient();

      expect(() => client.get(path, { audience })).toThrow(ApiClientError);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['customer', '/orders/../admin/users'],
    ['admin', '/admin/../orders'],
    ['customer', '/orders/%2e%2e/admin/users'],
    ['admin', '/admin/%2E%2E/orders'],
    ['customer', '/orders/%252e%252e/admin/users'],
    ['admin', '/admin/%252E%252E/orders'],
    ['customer', '/orders/./admin/users'],
    ['customer', '/orders/%2e/admin/users'],
    ['customer', '/orders/%2fadmin/users'],
    ['customer', '/orders/%252Fadmin/users'],
    ['customer', '/orders/%5cadmin/users'],
    ['customer', '/orders/%255Cadmin/users'],
    ['customer', '/orders/%2e%252e/admin/users'],
  ] as const)(
    'rejects canonicalization bypass for %s audience path %s',
    async (audience, path) => {
      const { client, request } = createClient();

      expect(() => client.get(path, { audience })).toThrow(ApiClientError);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([
    '/products/release..2026',
    '/products/v1.2.3',
    '/products/sku%2E2026',
    '/products/%E7%94%9F%E6%97%A5%E8%9B%8B%E7%B3%95',
  ])('accepts legal customer resource identifier %s', async (path) => {
    const { client, request } = createClient();

    await expect(client.get(path, { audience: 'customer' })).resolves.toEqual({
      ok: true,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('allows unauthenticated same-origin login without leaking credentials into the URL or logs', async () => {
    const { client, request } = createClient();

    await client.post('/auth/wechat/login', { code: 'one-time-secret' });

    const options = request.mock.calls[0]?.[0];
    expect(options?.url).toBe(
      'https://mall.example.com/api/v1/auth/wechat/login',
    );
    expect(options?.data).toEqual({ code: 'one-time-secret' });
    expect(options?.header).toEqual({ 'content-type': 'application/json' });
    expect(JSON.stringify(options?.url)).not.toContain('one-time-secret');
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('maps backend ApiError payloads to ApiClientError', async () => {
    const request = vi.fn((options: RequestOptions) => {
      options.success?.({
        data: {
          code: 'ADMIN_PERMISSION_DENIED',
          message: 'permission denied',
          requestId: 'request-1',
          details: { permission: 'USER_CREATE' },
        },
        statusCode: 403,
        header: {},
        cookies: [],
        profile: {} as WechatMiniprogram.RequestProfile,
        exception: { reasons: [], retryCount: 0 },
        useHttpDNS: false,
        errMsg: 'request:ok',
      });
      return {} as WechatMiniprogram.RequestTask;
    });
    const { client } = createClient(request);

    await expect(
      client.get('/admin/users', { audience: 'admin' }),
    ).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 403,
      code: 'ADMIN_PERMISSION_DENIED',
      message: 'permission denied',
      requestId: 'request-1',
      details: { permission: 'USER_CREATE' },
    });
  });

  it.each(['admin', 'customer'] as const)(
    'clears only the %s session on 401',
    async (audience) => {
      const request = vi.fn((options: RequestOptions) => {
        options.success?.({
          data: { message: 'unauthorized' },
          statusCode: 401,
          header: {},
          cookies: [],
          profile: {} as WechatMiniprogram.RequestProfile,
          exception: { reasons: [], retryCount: 0 },
          useHttpDNS: false,
          errMsg: 'request:ok',
        });
        return {} as WechatMiniprogram.RequestTask;
      });
      const { admin, client, customer } = createClient(request);
      const path = audience === 'admin' ? '/admin/users' : '/orders';

      await expect(client.get(path, { audience })).rejects.toMatchObject({
        status: 401,
      });

      expect(admin.get()).toEqual(audience === 'admin' ? null : adminSession);
      expect(customer.get()).toEqual(
        audience === 'customer' ? null : customerSession,
      );
    },
  );

  it.each(['admin', 'customer'] as const)(
    'keeps a newer %s session when an older request later returns 401',
    async (audience) => {
      let rejectOlderRequest: (() => void) | undefined;
      const request = vi.fn((options: RequestOptions) => {
        rejectOlderRequest = () => {
          options.success?.({
            data: { message: 'unauthorized' },
            statusCode: 401,
            header: {},
            cookies: [],
            profile: {} as WechatMiniprogram.RequestProfile,
            exception: { reasons: [], retryCount: 0 },
            useHttpDNS: false,
            errMsg: 'request:ok',
          });
        };
        return {} as WechatMiniprogram.RequestTask;
      });
      const { admin, client, customer } = createClient(request);
      const pending = client.get(
        audience === 'admin' ? '/admin/users' : '/orders',
        { audience },
      );
      const newerAdmin = { ...adminSession, accessToken: 'new-admin-token' };
      const newerCustomer = {
        ...customerSession,
        accessToken: 'new-customer-token',
      };
      if (audience === 'admin') admin.set(newerAdmin);
      if (audience === 'customer') customer.set(newerCustomer);

      rejectOlderRequest?.();
      await expect(pending).rejects.toMatchObject({ status: 401 });

      expect(admin.get()).toEqual(
        audience === 'admin' ? newerAdmin : adminSession,
      );
      expect(customer.get()).toEqual(
        audience === 'customer' ? newerCustomer : customerSession,
      );
    },
  );

  it('maps wx timeout failures without logging request data', async () => {
    const request = vi.fn((options: RequestOptions) => {
      options.fail?.({
        errMsg: 'request:fail timeout',
        errno: 5,
        exception: { reasons: [], retryCount: 0 },
        useHttpDNS: false,
      });
      return {} as WechatMiniprogram.RequestTask;
    });
    const { client } = createClient(request);

    await expect(
      client.post('/auth/wechat/login', { code: 'one-time-secret' }),
    ).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 0,
      message: '请求超时，请稍后重试',
    });
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
