import {
  AdminRole,
  OPERATOR_PERMISSIONS,
  type AdminSessionView,
  type CustomerAuthSessionView,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createAdminSessionStore,
  createCustomerSessionStore,
} from '../../utils/admin-session.js';
import {
  createAdminAuthController,
  createAdminPasswordController,
} from './admin-auth.js';

const customerSession = (
  overrides: Partial<CustomerAuthSessionView['profile']> = {},
): CustomerAuthSessionView => ({
  accessToken: 'customer-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  profile: {
    id: 'user-1',
    phone: '13800000000',
    phoneVerified: true,
    orderContactPhone: {
      configured: false,
      maskedPhone: null,
      version: 0,
    },
    ...overrides,
  },
});

const restrictedSession: AdminSessionView = {
  accessToken: 'restricted-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: [],
  mustChangePassword: true,
};

const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function authHarness() {
  const adminSession = createAdminSessionStore();
  const customer = createCustomerSessionStore();
  const api = {
    exchange: vi.fn<() => Promise<AdminSessionView>>(),
    loginWithWechat:
      vi.fn<(code: string) => Promise<CustomerAuthSessionView>>(),
  };
  const login = vi.fn<() => Promise<string>>();
  const navigate = vi.fn<(route: string) => void>();
  const toast = vi.fn<(message: string) => void>();
  const controller = createAdminAuthController({
    adminSession,
    customerSession: customer,
    api,
    login,
    navigate,
    toast,
  });
  return { adminSession, api, controller, customer, login, navigate, toast };
}

describe('createAdminAuthController', () => {
  it('uses a fresh wx login result to expose the entry only for an eligible operator', async () => {
    const harness = authHarness();
    harness.customer.set(customerSession({ id: 'old-user' }));
    harness.login.mockResolvedValue('fresh-login-code');
    harness.api.loginWithWechat.mockResolvedValue(customerSession());
    harness.api.exchange.mockResolvedValue(operatorSession);

    await expect(harness.controller.refreshEligibility()).resolves.toBe(true);

    expect(harness.login).toHaveBeenCalledOnce();
    expect(harness.api.loginWithWechat).toHaveBeenCalledWith(
      'fresh-login-code',
    );
    expect(harness.api.exchange).toHaveBeenCalledOnce();
    expect(harness.controller.snapshot()).toMatchObject({
      eligible: true,
      loading: false,
    });
    expect(harness.customer.get()).toEqual(customerSession());
    expect(harness.adminSession.get()).toBeNull();
  });

  it('keeps the entry hidden for a non-admin without reflecting server details', async () => {
    const harness = authHarness();
    harness.login.mockResolvedValue('fresh-login-code');
    harness.api.loginWithWechat.mockResolvedValue(customerSession());
    harness.api.exchange.mockRejectedValue({
      status: 403,
      message: 'raw identity',
    });

    await expect(harness.controller.refreshEligibility()).resolves.toBe(false);

    expect(harness.controller.snapshot()).toEqual({
      eligible: false,
      loading: false,
    });
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it('keeps automatic eligibility network failures silent during page startup', async () => {
    const harness = authHarness();
    harness.login.mockResolvedValue('fresh-login-code');
    harness.api.loginWithWechat.mockRejectedValue({
      status: 0,
      message: 'network unavailable',
    });

    await expect(harness.controller.refreshEligibility()).resolves.toBe(false);

    expect(harness.controller.snapshot()).toEqual({
      eligible: false,
      loading: false,
    });
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it('still reports a safe error after an explicit management entry attempt', async () => {
    const harness = authHarness();
    harness.login.mockResolvedValue('fresh-login-code');
    harness.api.loginWithWechat.mockRejectedValue({
      status: 0,
      message: 'network unavailable',
    });

    await expect(harness.controller.enterAdmin()).resolves.toBe(false);

    expect(harness.toast).toHaveBeenCalledWith('管理入口暂不可用，请稍后重试');
  });

  it('removes a previously eligible entry while checking a fresh ineligible identity', async () => {
    const harness = authHarness();
    harness.login.mockResolvedValue('eligible-code');
    harness.api.loginWithWechat.mockResolvedValue(customerSession());
    harness.api.exchange.mockResolvedValue(operatorSession);
    await harness.controller.refreshEligibility();

    harness.login.mockResolvedValue('phone-required-code');
    harness.api.loginWithWechat.mockResolvedValue(
      customerSession({ phone: undefined, phoneVerified: false }),
    );
    harness.api.exchange.mockRejectedValueOnce({ status: 403 });
    const refresh = harness.controller.refreshEligibility();

    expect(harness.controller.snapshot()).toEqual({
      eligible: false,
      loading: true,
    });
    await expect(refresh).resolves.toBe(false);
    expect(harness.controller.snapshot()).toEqual({
      eligible: false,
      loading: false,
    });
    expect(harness.adminSession.get()).toBeNull();
  });

  it('does another fresh login on entry and routes must-change sessions to initial password', async () => {
    const harness = authHarness();
    harness.customer.set(customerSession({ id: 'already-present' }));
    harness.login.mockResolvedValue('entry-code');
    harness.api.loginWithWechat.mockResolvedValue(customerSession());
    harness.api.exchange.mockResolvedValue(restrictedSession);

    await expect(harness.controller.enterAdmin()).resolves.toBe(true);

    expect(harness.api.loginWithWechat).toHaveBeenCalledWith('entry-code');
    expect(harness.adminSession.get()).toEqual(restrictedSession);
    expect(harness.navigate).toHaveBeenCalledWith(
      '/pages/admin-password/index',
    );
  });

  it('phoneVerified=false 仍按显式授权直接 exchange，不进入手机号授权页', async () => {
    const harness = authHarness();
    harness.login.mockResolvedValue('entry-code');
    harness.api.loginWithWechat.mockResolvedValue(
      customerSession({ phone: undefined, phoneVerified: false }),
    );
    harness.api.exchange.mockResolvedValue(operatorSession);

    await expect(harness.controller.enterAdmin()).resolves.toBe(true);

    expect(harness.api.exchange).toHaveBeenCalledOnce();
    expect(harness.adminSession.get()).toEqual(operatorSession);
    expect(harness.navigate).toHaveBeenCalledWith('/pages/admin-home/index');
    expect(harness.navigate).not.toHaveBeenCalledWith(
      expect.stringContaining('phone-auth'),
    );
  });

  it('ignores stale login generations that resolve after the latest entry attempt', async () => {
    const harness = authHarness();
    const staleLogin = deferred<CustomerAuthSessionView>();
    harness.login
      .mockResolvedValueOnce('old-code')
      .mockResolvedValueOnce('new-code');
    harness.api.loginWithWechat
      .mockReturnValueOnce(staleLogin.promise)
      .mockResolvedValueOnce(customerSession({ id: 'new-user' }));
    harness.api.exchange.mockResolvedValue(operatorSession);

    const stale = harness.controller.enterAdmin();
    const current = harness.controller.enterAdmin();
    await expect(current).resolves.toBe(true);
    staleLogin.resolve(customerSession({ id: 'old-user' }));
    await expect(stale).resolves.toBe(false);

    expect(harness.customer.get()?.profile.id).toBe('new-user');
    expect(harness.navigate).toHaveBeenCalledTimes(1);
  });
});

describe('createAdminPasswordController', () => {
  it.each([
    ['initial', restrictedSession, 'changeInitial'],
    ['current', operatorSession, 'changeCurrent'],
  ] as const)(
    'submits and clears all three fields in %s mode',
    async (_mode, session, method) => {
      const store = createAdminSessionStore();
      store.set(session);
      const api = {
        changeInitial: vi.fn().mockResolvedValue(operatorSession),
        changeCurrent: vi.fn().mockResolvedValue(operatorSession),
      };
      const controller = createAdminPasswordController({
        adminSession: store,
        api,
      });
      controller.replaceForm({
        currentPassword: '123456',
        newPassword: '654321',
        confirmPassword: '654321',
      });

      await expect(controller.submit()).resolves.toEqual(operatorSession);

      expect(api[method]).toHaveBeenCalledWith(
        method === 'changeInitial'
          ? {
              temporaryPassword: '123456',
              newPassword: '654321',
              confirmPassword: '654321',
            }
          : {
              currentPassword: '123456',
              newPassword: '654321',
              confirmPassword: '654321',
            },
      );
      expect(controller.snapshot().form).toEqual({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    },
  );

  it('clears secrets and uses a safe error when validation fails', async () => {
    const store = createAdminSessionStore();
    store.set(operatorSession);
    const api = { changeInitial: vi.fn(), changeCurrent: vi.fn() };
    const controller = createAdminPasswordController({
      adminSession: store,
      api,
    });
    controller.replaceForm({
      currentPassword: 'secret-current',
      newPassword: '654321',
      confirmPassword: '000000',
    });

    await expect(controller.submit()).rejects.toThrow('两次输入的新密码不一致');

    expect(api.changeCurrent).not.toHaveBeenCalled();
    expect(JSON.stringify(controller.snapshot())).not.toContain(
      'secret-current',
    );
  });
});
