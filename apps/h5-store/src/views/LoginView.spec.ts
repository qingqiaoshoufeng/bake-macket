import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { CustomerProfileView } from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import {
  DEVELOPMENT_LOGIN_HINT,
  miniappMessageHub,
  requestMiniappPhoneCredential,
} from '../bridge/miniapp.js';
import LoginView from './LoginView.vue';
import { useAuthStore } from '../stores/auth.js';
import { loginFeatureApi } from './login/api/index.js';

vi.mock('./login/api/index.js', () => ({
  loginFeatureApi: { login: vi.fn(), getProfile: vi.fn() },
}));

vi.mock('vant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vant')>();
  return { ...actual, showToast: vi.fn() };
});

vi.mock('../bridge/miniapp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bridge/miniapp.js')>();
  return {
    ...actual,
    miniappMessageHub: {
      publish: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
    requestMiniappPhoneCredential: vi.fn(async () => true),
  };
});

const mountLogin = async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/', component: { template: '<div>store</div>' } },
    ],
  });
  await router.push('/login');
  await router.isReady();

  return {
    pinia,
    wrapper: mount(LoginView, {
      global: { plugins: [pinia, router] },
    }),
  };
};

const getPhone = (wrapper: VueWrapper) =>
  wrapper.get('input[autocomplete="tel"]');
const getCode = (wrapper: VueWrapper) =>
  wrapper.get('input[autocomplete="one-time-code"]');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginView', () => {
  it('subscribes to the global in-memory hub and unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn();
    vi.mocked(miniappMessageHub.subscribe).mockReturnValueOnce(unsubscribe);
    const { wrapper } = await mountLogin();

    expect(miniappMessageHub.subscribe).toHaveBeenCalledOnce();
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('renders the shared development credentials', async () => {
    const { wrapper } = await mountLogin();

    expect(wrapper.get('main').classes()).toContain('store-auth-page');
    expect((getPhone(wrapper).element as HTMLInputElement).value).toBe(
      DEVELOPMENT_LOGIN_HINT.phone,
    );
    expect((getCode(wrapper).element as HTMLInputElement).value).toBe(
      DEVELOPMENT_LOGIN_HINT.code,
    );
  });

  it('submits the rendered credentials and applies the real customer profile', async () => {
    const profile = {
      id: 'customer-1',
      nickname: '烘焙客',
      avatarUrl: null,
      phone: '138****0000',
    } satisfies CustomerProfileView;
    vi.mocked(loginFeatureApi.login).mockResolvedValue({
      accessToken: 'user-token-1',
      expiresAt: '2026-07-12T01:00:00.000Z',
    });
    vi.mocked(loginFeatureApi.getProfile).mockResolvedValue(profile);
    const { wrapper } = await mountLogin();

    await wrapper.get('form').trigger('submit.prevent');

    expect(loginFeatureApi.login).toHaveBeenCalledWith(
      DEVELOPMENT_LOGIN_HINT.phone,
      DEVELOPMENT_LOGIN_HINT.code,
    );
    expect(loginFeatureApi.getProfile).toHaveBeenCalledWith('user-token-1');
    expect(useAuthStore().profile).toEqual({
      id: profile.id,
      nickname: profile.nickname,
      avatarUrl: undefined,
      phone: profile.phone,
      phoneVerified: true,
    });
  });

  it('does not retain an authenticated session when loading /me fails', async () => {
    vi.mocked(loginFeatureApi.login).mockResolvedValue({
      accessToken: 'user-token-1',
      expiresAt: '2026-07-12T01:00:00.000Z',
    });
    vi.mocked(loginFeatureApi.getProfile).mockRejectedValue(
      new Error('资料加载失败'),
    );
    const { wrapper } = await mountLogin();

    await wrapper.get('form').trigger('submit.prevent');

    expect(useAuthStore().accessToken).toBeNull();
    expect(useAuthStore().profile).toBeNull();
  });

  it('keeps the development quick-fill action', async () => {
    const { wrapper } = await mountLogin();
    await getPhone(wrapper).setValue('');
    await getCode(wrapper).setValue('');
    await wrapper.get('.login__dev .link').trigger('click');

    expect((getPhone(wrapper).element as HTMLInputElement).value).toBe(
      DEVELOPMENT_LOGIN_HINT.phone,
    );
    expect((getCode(wrapper).element as HTMLInputElement).value).toBe(
      DEVELOPMENT_LOGIN_HINT.code,
    );
  });

  it('publishes the development WECHAT_CODE directly through the in-memory hub', async () => {
    const { wrapper } = await mountLogin();

    const devButtons = wrapper.findAll('.login__dev button');
    await devButtons[1]?.trigger('click');

    expect(miniappMessageHub.publish).toHaveBeenCalledWith({
      source: 'bake-miniapp',
      type: 'WECHAT_CODE',
      code: 'dev-wechat-code',
    });
  });

  it('shows a user-facing miniapp phone button and awaits native authorization navigation', async () => {
    const { wrapper } = await mountLogin();

    const button = wrapper.get('button[data-testid="miniapp-phone-auth"]');
    expect(button.text()).toContain('微信手机号');
    await button.trigger('click');

    expect(requestMiniappPhoneCredential).toHaveBeenCalledOnce();
  });

  it('reports a failed native navigation instead of treating API presence as success', async () => {
    vi.mocked(requestMiniappPhoneCredential).mockResolvedValueOnce(false);
    const { showToast } = await import('vant');
    const { wrapper } = await mountLogin();

    await wrapper
      .get('button[data-testid="miniapp-phone-auth"]')
      .trigger('click');
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('请在微信小程序中使用手机号授权'),
    );
  });
});
