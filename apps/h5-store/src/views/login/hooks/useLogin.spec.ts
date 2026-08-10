import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerAuthSessionView } from '@bake-mall/contracts';

import {
  makeWechatCodeMessage,
  miniappMessageHub,
  type MiniappMessage,
} from '../../../bridge/miniapp.js';
import { useAuthStore } from '../../../stores/auth.js';
import { useLogin } from './useLogin.js';

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  login: vi.fn(),
  loginWithWechatCode: vi.fn(),
  bindWechatPhone: vi.fn(),
}));

vi.mock('../api/index.js', () => ({
  loginFeatureApi: {
    getProfile: apiMocks.getProfile,
    login: apiMocks.login,
    loginWithWechatCode: apiMocks.loginWithWechatCode,
    bindWechatPhone: apiMocks.bindWechatPhone,
  },
}));

const anonymousSession = {
  accessToken: 'wechat-user-token',
  expiresAt: '2026-08-07T00:00:00.000Z',
  profile: {
    id: 'user-1',
    nickname: '微信顾客',
    avatarUrl: undefined,
    phone: undefined,
    phoneVerified: false,
  },
} satisfies CustomerAuthSessionView;

const verifiedSession = {
  accessToken: 'canonical-user-token',
  expiresAt: '2026-08-07T00:10:00.000Z',
  profile: {
    id: 'user-9',
    nickname: '微信顾客',
    avatarUrl: undefined,
    phone: '138****0000',
    phoneVerified: true,
  },
} satisfies CustomerAuthSessionView;

function mountLogin(notify = vi.fn(), isDevelopment = false) {
  let login!: ReturnType<typeof useLogin>;
  const wrapper = mount({
    setup() {
      login = useLogin(isDevelopment, notify);
      return login;
    },
    template: '<div />',
  });
  return { wrapper, notify, login };
}

function phoneMessage(credential: string): MiniappMessage {
  return { source: 'bake-miniapp', type: 'PHONE_CREDENTIAL', credential };
}

function expectAuthSession(session: CustomerAuthSessionView): void {
  expect(useAuthStore().$state).toEqual({
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    profile: session.profile,
  });
}

describe('useLogin 微信 bridge 编排', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    vi.clearAllMocks();
    apiMocks.loginWithWechatCode.mockResolvedValue(anonymousSession);
    apiMocks.bindWechatPhone.mockResolvedValue(verifiedSession);
  });

  it('收到 WECHAT_CODE 后立即兑换并原子应用完整顾客 session', async () => {
    const { wrapper, notify } = mountLogin();

    miniappMessageHub.publish(makeWechatCodeMessage('wechat-login-code'));

    await vi.waitFor(() =>
      expect(apiMocks.loginWithWechatCode).toHaveBeenCalledWith(
        'wechat-login-code',
      ),
    );
    await vi.waitFor(() => expectAuthSession(anonymousSession));
    expect(notify).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/等待后端接通/u),
      }),
    );
    wrapper.unmount();
  });

  it('先完成登录再用当前 mall-user auth 处理 PHONE_CREDENTIAL 并应用 canonical session', async () => {
    let resolveLogin!: (session: CustomerAuthSessionView) => void;
    let loginSettled = false;
    apiMocks.loginWithWechatCode.mockReturnValue(
      new Promise<CustomerAuthSessionView>((resolve) => {
        resolveLogin = resolve;
      }).finally(() => {
        loginSettled = true;
      }),
    );
    apiMocks.bindWechatPhone.mockImplementation(async () => {
      if (!loginSettled) throw new Error('phone called before login settled');
      return verifiedSession;
    });
    const { wrapper } = mountLogin();

    miniappMessageHub.publish(makeWechatCodeMessage('wechat-login-code'));
    miniappMessageHub.publish(phoneMessage('wechat-phone-code'));

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(apiMocks.bindWechatPhone).not.toHaveBeenCalled();
    resolveLogin(anonymousSession);
    await vi.waitFor(() =>
      expect(apiMocks.bindWechatPhone).toHaveBeenCalledWith(
        'wechat-phone-code',
      ),
    );
    await vi.waitFor(() => expectAuthSession(verifiedSession));
    wrapper.unmount();
  });

  it('重复活跃 WECHAT_CODE 只调用一次且唯一响应仍应用 session', async () => {
    let resolveLogin!: (session: CustomerAuthSessionView) => void;
    apiMocks.loginWithWechatCode.mockReturnValue(
      new Promise<CustomerAuthSessionView>((resolve) => {
        resolveLogin = resolve;
      }),
    );
    const { wrapper } = mountLogin();
    const duplicate = makeWechatCodeMessage('duplicate-code');

    miniappMessageHub.publish(duplicate);
    miniappMessageHub.publish(duplicate);
    await vi.waitFor(() =>
      expect(apiMocks.loginWithWechatCode).toHaveBeenCalledTimes(1),
    );
    resolveLogin(anonymousSession);

    await vi.waitFor(() => expectAuthSession(anonymousSession));
    wrapper.unmount();
  });

  it('对重复 PHONE bridge credential 只发起一次请求', async () => {
    const { wrapper } = mountLogin();
    useAuthStore().applyCustomerSession(anonymousSession);
    const message = phoneMessage('duplicate-phone-credential');

    miniappMessageHub.publish(message);
    miniappMessageHub.publish(message);

    await vi.waitFor(() =>
      expect(apiMocks.bindWechatPhone).toHaveBeenCalledTimes(1),
    );
    wrapper.unmount();
  });

  it('前一个手机号请求失败后仍可处理下一个凭证', async () => {
    apiMocks.bindWechatPhone
      .mockRejectedValueOnce(new Error('first phone failed'))
      .mockResolvedValueOnce(verifiedSession);
    useAuthStore().applyCustomerSession(anonymousSession);
    const { wrapper } = mountLogin();

    miniappMessageHub.publish(phoneMessage('first-phone-code'));
    await vi.waitFor(() =>
      expect(apiMocks.bindWechatPhone).toHaveBeenCalledWith('first-phone-code'),
    );
    miniappMessageHub.publish(phoneMessage('second-phone-code'));

    await vi.waitFor(() =>
      expect(apiMocks.bindWechatPhone).toHaveBeenCalledWith(
        'second-phone-code',
      ),
    );
    await vi.waitFor(() =>
      expect(useAuthStore().profile?.id).toBe(verifiedSession.profile.id),
    );
    wrapper.unmount();
  });

  it('A login 等待期间排队的 PHONE 在 B login 完成后失效且不发送绑定请求', async () => {
    let resolveLoginA!: (session: CustomerAuthSessionView) => void;
    apiMocks.loginWithWechatCode
      .mockReturnValueOnce(
        new Promise<CustomerAuthSessionView>((resolve) => {
          resolveLoginA = resolve;
        }),
      )
      .mockResolvedValueOnce(verifiedSession);
    const { wrapper } = mountLogin();

    miniappMessageHub.publish(makeWechatCodeMessage('login-user-a'));
    await vi.waitFor(() =>
      expect(apiMocks.loginWithWechatCode).toHaveBeenCalledWith('login-user-a'),
    );
    miniappMessageHub.publish(phoneMessage('phone-for-user-a'));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    miniappMessageHub.publish(makeWechatCodeMessage('login-user-b'));
    await vi.waitFor(() => expectAuthSession(verifiedSession));

    resolveLoginA(anonymousSession);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(apiMocks.bindWechatPhone).not.toHaveBeenCalled();
    expectAuthSession(verifiedSession);
    wrapper.unmount();
  });

  it('旧 PHONE 响应不能覆盖随后完成的新 login session', async () => {
    let resolvePhone!: (session: CustomerAuthSessionView) => void;
    apiMocks.bindWechatPhone.mockReturnValue(
      new Promise<CustomerAuthSessionView>((resolve) => {
        resolvePhone = resolve;
      }),
    );
    apiMocks.loginWithWechatCode.mockResolvedValue(verifiedSession);
    useAuthStore().applyCustomerSession(anonymousSession);
    const { wrapper } = mountLogin();

    miniappMessageHub.publish(phoneMessage('phone-for-user-a'));
    await vi.waitFor(() =>
      expect(apiMocks.bindWechatPhone).toHaveBeenCalledWith('phone-for-user-a'),
    );
    miniappMessageHub.publish(makeWechatCodeMessage('login-for-user-b'));
    await vi.waitFor(() =>
      expect(useAuthStore().profile?.id).toBe(verifiedSession.profile.id),
    );
    resolvePhone({
      ...anonymousSession,
      accessToken: 'late-phone-token-for-a',
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expectAuthSession(verifiedSession);
    wrapper.unmount();
  });

  it('旧 PHONE 响应不能覆盖随后完成的开发登录 session', async () => {
    let resolvePhone!: (session: CustomerAuthSessionView) => void;
    apiMocks.bindWechatPhone.mockReturnValue(
      new Promise<CustomerAuthSessionView>((resolve) => {
        resolvePhone = resolve;
      }),
    );
    apiMocks.login.mockResolvedValue({
      accessToken: verifiedSession.accessToken,
      expiresAt: verifiedSession.expiresAt,
    });
    apiMocks.getProfile.mockResolvedValue(verifiedSession.profile);
    useAuthStore().applyCustomerSession(anonymousSession);
    const { wrapper, login } = mountLogin(vi.fn(), true);

    miniappMessageHub.publish(phoneMessage('phone-before-dev-login'));
    await vi.waitFor(() =>
      expect(apiMocks.bindWechatPhone).toHaveBeenCalledWith(
        'phone-before-dev-login',
      ),
    );
    await expect(login.methods.submit()).resolves.toBe(true);
    resolvePhone({
      ...anonymousSession,
      accessToken: 'late-phone-token-before-dev-login',
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expectAuthSession(verifiedSession);
    wrapper.unmount();
  });

  it('较早请求晚返回时不覆盖更新的顾客 session', async () => {
    let resolveFirst!: (session: CustomerAuthSessionView) => void;
    apiMocks.loginWithWechatCode
      .mockReturnValueOnce(
        new Promise<CustomerAuthSessionView>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(verifiedSession);
    const { wrapper } = mountLogin();

    miniappMessageHub.publish(makeWechatCodeMessage('first-code'));
    miniappMessageHub.publish(makeWechatCodeMessage('second-code'));
    resolveFirst(anonymousSession);

    await vi.waitFor(() =>
      expect(useAuthStore().profile?.id).toBe(verifiedSession.profile.id),
    );
    wrapper.unmount();
  });
});
