import { afterEach, describe, expect, it, vi } from 'vitest';

import { usersApi } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('users api', () => {
  it('composes list query and create requests through the global client', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [], total: 0, page: 2, pageSize: 50 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'user-1',
            nickname: null,
            identityPhoneMasked: '139****0000',
            identityPhoneVerified: false,
            wechatBound: false,
            loginPhoneMasked: null,
            createdAt: '2026-08-06T08:00:00.000Z',
            isOperator: false,
            operatorActive: false,
            mustChangePassword: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await usersApi.list({ q: '小莓', page: 2, pageSize: 50 });
    await usersApi.create({ phone: '13900000000' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/admin/users?q=%E5%B0%8F%E8%8E%93&page=2&pageSize=50',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/admin/users');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      phone: '13900000000',
    });
  });

  it('passes shared grant and revoke DTOs without transformation', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ userId: 'user-1', operator: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await usersApi.grantOperator('user-1', {
      loginPhone: '13700000000',
      currentPassword: '123456',
      temporaryPassword: '234567',
      confirmTemporaryPassword: '234567',
    });
    await usersApi.revokeOperator('user-1', {
      currentPassword: '123456',
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/admin/users/user-1/operator/grant',
      '/api/v1/admin/users/user-1/operator/revoke',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      loginPhone: '13700000000',
      currentPassword: '123456',
      temporaryPassword: '234567',
      confirmTemporaryPassword: '234567',
    });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      currentPassword: '123456',
    });
  });
});
