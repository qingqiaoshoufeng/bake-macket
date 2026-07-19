import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import {
  DEVELOPMENT_LOGIN_HINT,
  installMiniappBridge,
} from '../bridge/miniapp.js';
import LoginView from './LoginView.vue';
import { loginFeatureApi } from './login/api/index.js';

vi.mock('./login/api/index.js', () => ({
  loginFeatureApi: { login: vi.fn() },
}));

vi.mock('vant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vant')>();
  return { ...actual, showToast: vi.fn() };
});

vi.mock('../bridge/miniapp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bridge/miniapp.js')>();
  return {
    ...actual,
    installMiniappBridge: vi.fn(() => vi.fn()),
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
  it('removes the miniapp message listener when the view unmounts', async () => {
    const teardown = vi.fn();
    vi.mocked(installMiniappBridge).mockReturnValueOnce(teardown);
    const { wrapper } = await mountLogin();

    expect(installMiniappBridge).toHaveBeenCalledOnce();
    wrapper.unmount();
    expect(teardown).toHaveBeenCalledOnce();
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

  it('submits the rendered credentials through the login feature API', async () => {
    vi.mocked(loginFeatureApi.login).mockResolvedValue({
      accessToken: 'user-token-1',
      expiresAt: '2026-07-12T01:00:00.000Z',
    });
    const { wrapper } = await mountLogin();

    await wrapper.get('form').trigger('submit.prevent');

    expect(loginFeatureApi.login).toHaveBeenCalledWith(
      DEVELOPMENT_LOGIN_HINT.phone,
      DEVELOPMENT_LOGIN_HINT.code,
    );
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
});
