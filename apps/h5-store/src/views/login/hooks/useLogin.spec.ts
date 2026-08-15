import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerProfileView } from '@bake-mall/contracts';

import { miniappMessageHub } from '../../../bridge/miniapp.js';
import { useAuthStore } from '../../../stores/auth.js';
import { useLogin } from './useLogin.js';

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  login: vi.fn(),
}));

vi.mock('../api/index.js', () => ({
  loginFeatureApi: {
    getProfile: apiMocks.getProfile,
    login: apiMocks.login,
  },
}));

function mountLogin(notify = vi.fn(), isDevelopment = true) {
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

describe('useLogin 开发辅助', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('不再订阅小程序 bridge，顾客微信 code 由应用级协调器消费', () => {
    const subscribe = vi.spyOn(miniappMessageHub, 'subscribe');
    const { wrapper } = mountLogin();

    expect(subscribe).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('开发登录成功后应用完整本地顾客资料', async () => {
    const profile = {
      id: 'customer-1',
      nickname: '烘焙客',
      avatarUrl: null,
      phone: '138****0000',
      phoneVerified: true,
      orderContactPhone: {
        configured: true,
        maskedPhone: '139****0000',
        version: 1,
      },
    } satisfies CustomerProfileView;
    apiMocks.login.mockResolvedValue({
      accessToken: 'user-token-1',
      expiresAt: '2026-08-14T16:00:00.000Z',
    });
    apiMocks.getProfile.mockResolvedValue(profile);
    const { login, notify } = mountLogin();

    await expect(login.methods.submit()).resolves.toBe(true);

    expect(useAuthStore().profile).toMatchObject({
      id: profile.id,
      phone: profile.phone,
      phoneVerified: true,
    });
    expect(notify).toHaveBeenCalledWith({
      type: 'success',
      message: '登录成功',
    });
  });

  it('开发按钮仍把 WECHAT_CODE 发布到全局消息 hub', () => {
    const publish = vi.spyOn(miniappMessageHub, 'publish');
    const { login } = mountLogin();

    login.methods.testWechatCode();

    expect(publish).toHaveBeenCalledWith({
      source: 'bake-miniapp',
      type: 'WECHAT_CODE',
      code: 'dev-wechat-code',
    });
  });
});
