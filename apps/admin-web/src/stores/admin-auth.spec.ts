import {
  AdminPermission,
  AdminRole,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../api/http.js';
import { useAdminAuthStore } from './admin-auth.js';

const HYDRATE_NOW = Date.parse('2026-08-06T12:00:00.000Z');
const FUTURE_EXPIRY = '2026-08-06T12:00:00.001Z';

const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: FUTURE_EXPIRY,
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

const restrictedOperatorSession: AdminSessionView = {
  accessToken: 'restricted-token',
  expiresAt: FUTURE_EXPIRY,
  role: AdminRole.OPERATOR,
  permissions: [],
  mustChangePassword: true,
};

const superAdminSession: AdminSessionView = {
  accessToken: 'super-token',
  expiresAt: FUTURE_EXPIRY,
  role: AdminRole.SUPER_ADMIN,
  permissions: SUPER_ADMIN_PERMISSIONS,
  mustChangePassword: false,
};

const SESSION_STORAGE_KEY = 'bake_admin_session';
const LEGACY_TOKEN_STORAGE_KEY = 'bake_admin_token';
const PENDING_DEVICE_OPERATIONS_STORAGE_KEY =
  'bake_admin_pending_device_operations';

describe('useAdminAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.sessionStorage.clear();
    apiClient.setAccessToken(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the login redirect when no admin session is present', () => {
    const store = useAdminAuthStore();

    expect(store.requireAdminAuth('/products')).toBe(
      '/login?redirect=%2Fproducts',
    );
  });

  it('atomically applies and persists the complete operator session', () => {
    const store = useAdminAuthStore();

    store.applySession(operatorSession, { identifier: '13800000000' });

    expect(store.session).toEqual(operatorSession);
    expect(store.profile).toEqual({ identifier: '13800000000' });
    expect(store.role).toBe(AdminRole.OPERATOR);
    expect(store.permissions).toEqual(OPERATOR_PERMISSIONS);
    expect(store.mustChangePassword).toBe(false);
    expect(store.hasPermission(AdminPermission.ORDER_READ)).toBe(true);
    expect(
      JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY)!),
    ).toEqual({
      session: operatorSession,
      profile: { identifier: '13800000000' },
    });
  });

  it.each([
    ['operator', operatorSession, '13800000000'],
    ['restricted operator', restrictedOperatorSession, '13900000000'],
    ['super admin', superAdminSession, 'admin@example.com'],
  ])('hydrates a complete %s session', (_label, session, identifier) => {
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ session, profile: { identifier } }),
    );
    const store = useAdminAuthStore();

    store.hydrate(HYDRATE_NOW);

    expect(store.session).toEqual(session);
    expect(store.profile).toEqual({ identifier });
    expect(store.mustChangePassword).toBe(session.mustChangePassword);
    expect(store.requireAdminAuth('/orders')).toBeNull();
  });

  it.each([
    ['malformed JSON', '{not-json'],
    [
      'legacy token-only shape',
      JSON.stringify({ accessToken: 'legacy-admin-token' }),
    ],
    [
      'unknown role',
      JSON.stringify({
        session: { ...operatorSession, role: 'UNKNOWN' },
        profile: { identifier: '13800000000' },
      }),
    ],
    [
      'restricted session with permissions',
      JSON.stringify({
        session: {
          ...restrictedOperatorSession,
          permissions: [AdminPermission.ORDER_READ],
        },
        profile: { identifier: '13800000000' },
      }),
    ],
  ])('fails closed and removes %s storage', (_label, persistedValue) => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, persistedValue);
    window.sessionStorage.setItem(
      LEGACY_TOKEN_STORAGE_KEY,
      'h5-or-stale-token',
    );
    const store = useAdminAuthStore();

    store.hydrate();

    expect(store.session).toBeNull();
    expect(store.profile).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(LEGACY_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ['expired', '2026-08-06T11:59:59.999Z'],
    ['equal to now', '2026-08-06T12:00:00.000Z'],
    ['invalid', 'not-a-date'],
  ])('fails closed when expiresAt is %s', (_label, expiresAt) => {
    const store = useAdminAuthStore();
    store.applySession(superAdminSession, {
      identifier: 'admin@example.com',
    });
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        session: { ...superAdminSession, expiresAt },
        profile: { identifier: 'admin@example.com' },
      }),
    );
    const setAccessToken = vi.spyOn(apiClient, 'setAccessToken');

    store.hydrate(HYDRATE_NOW);

    expect(store.session).toBeNull();
    expect(store.profile).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(LEGACY_TOKEN_STORAGE_KEY)).toBeNull();
    expect(setAccessToken).toHaveBeenLastCalledWith(null);
  });

  it('never hydrates the H5 customer token', () => {
    window.sessionStorage.setItem('bake_user_token', 'customer-token');
    const store = useAdminAuthStore();

    store.hydrate();

    expect(store.accessToken).toBeNull();
    expect(window.sessionStorage.getItem('bake_user_token')).toBe(
      'customer-token',
    );
  });

  it.each(['explicit logout', 'global 401'])(
    'clears pending printing operations on %s even when the printing page is not mounted',
    async (scenario) => {
      const store = useAdminAuthStore();
      store.applySession(superAdminSession, {
        identifier: 'admin@example.com',
      });
      window.sessionStorage.setItem(
        PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
        JSON.stringify({
          adminId: '42',
          pendingDeviceOperations: [
            {
              operation: 'refresh',
              resourceId: '1001',
              idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
            },
          ],
        }),
      );

      if (scenario === 'global 401') {
        apiClient.onUnauthorized(() => store.clearSession());
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ message: '登录已过期' }), {
              status: 401,
              headers: { 'content-type': 'application/json' },
            }),
          ),
        );
        await expect(apiClient.get('/admin/orders')).rejects.toMatchObject({
          status: 401,
        });
      } else {
        store.clearSession();
      }

      expect(store.session).toBeNull();
      expect(store.profile).toBeNull();
      expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
      expect(
        window.sessionStorage.getItem(PENDING_DEVICE_OPERATIONS_STORAGE_KEY),
      ).toBeNull();
    },
  );
});
