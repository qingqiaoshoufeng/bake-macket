import {
  AdminPermission,
  AdminRole,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

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
    AdminPermission.USER_WECHAT_IDENTITY_READ,
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
  profile: {
    id: '42',
    phoneVerified: false,
    orderContactPhone: {
      configured: false,
      maskedPhone: null,
      version: 0,
    },
  },
} as const;

describe('miniapp in-memory sessions', () => {
  it('keeps customer and admin sessions in independent memory stores', () => {
    const customer = createCustomerSessionStore();
    const admin = createAdminSessionStore();

    customer.set(customerSession);
    admin.set(adminSession);

    expect(customer.get()).toEqual(customerSession);
    expect(admin.get()).toEqual(adminSession);

    customer.clear();
    expect(customer.get()).toBeNull();
    expect(admin.get()).toEqual(adminSession);
  });

  it('does not persist either session through WeChat storage', () => {
    const setStorage = vi.fn();
    const setStorageSync = vi.fn();
    vi.stubGlobal('wx', { setStorage, setStorageSync });
    const customer = createCustomerSessionStore();
    const admin = createAdminSessionStore();

    customer.set(customerSession);
    admin.set(adminSession);
    customer.clear();
    admin.clear();

    expect(setStorage).not.toHaveBeenCalled();
    expect(setStorageSync).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('returns snapshots that cannot mutate the stored session', () => {
    const admin = createAdminSessionStore();
    admin.set(adminSession);

    const snapshot = admin.get();
    expect(snapshot).not.toBe(adminSession);
    expect(snapshot?.permissions).not.toBe(adminSession.permissions);

    expect(admin.get()).toEqual(adminSession);
  });
});
