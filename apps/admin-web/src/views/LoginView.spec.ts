import { readFileSync } from 'node:fs';

import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { useAdminAuthStore } from '../stores/admin-auth.js';
import LoginView from './LoginView.vue';

const elementPlusMocks = vi.hoisted(() => ({
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
const loginEndpoint = vi.hoisted(() => vi.fn());

vi.mock('./login/api/index.js', () => ({
  loginAsAdmin: loginEndpoint,
}));

vi.mock('./login/config/default-admin-login.js', async () => {
  const { ADMIN_LOGIN_FORM_MOCK } = await import('./login/mock/form.mock.js');
  return { getDefaultAdminLogin: () => ADMIN_LOGIN_FORM_MOCK };
});

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>();

  return {
    ...actual,
    ElMessage: elementPlusMocks,
  };
});

const mountLogin = async (initialPath = '/login') => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
      { path: '/orders', component: { template: '<div>orders</div>' } },
    ],
  });
  await router.push(initialPath);
  await router.isReady();

  return {
    pinia,
    router,
    wrapper: mount(LoginView, {
      global: { plugins: [pinia, router] },
    }),
  };
};

beforeEach(() => {
  loginEndpoint.mockResolvedValue({
    accessToken: 'admin-token-1',
    expiresAt: '2026-07-19T12:00:00.000Z',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LoginView', () => {
  it('renders the branded split entry while keeping the form primary', async () => {
    const { wrapper } = await mountLogin();

    expect(wrapper.get('main').classes()).toContain('admin-auth-page');
    expect(wrapper.find('[data-testid="admin-brand-art"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="admin-submit"]').text()).toContain(
      '登录',
    );
  });

  it('keeps the two-column layout shrink-safe and switches 1024px to form-only', () => {
    const source = readFileSync(
      `${process.cwd()}/src/views/LoginView.vue`,
      'utf8',
    );

    expect(source).toContain(
      'grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr)',
    );
    expect(source).toContain('@media (max-width: 1024px)');
    expect(source).toMatch(
      /@media \(max-width: 1024px\)[\s\S]*?\.admin-auth-page__art[\s\S]*?display: none/,
    );
  });

  it('renders configured development credentials', async () => {
    const { wrapper } = await mountLogin();

    expect(
      (wrapper.get('[data-testid="admin-email"]').element as HTMLInputElement)
        .value,
    ).toBe('admin@example.com');
    expect(
      (
        wrapper.get('[data-testid="admin-login-password"]')
          .element as HTMLInputElement
      ).value,
    ).toBe('admin-password');
  });

  it('submits through the feature endpoint and applies the session to the store', async () => {
    const { pinia, wrapper } = await mountLogin();
    const adminAuth = useAdminAuthStore(pinia);

    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(loginEndpoint).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'admin-password',
    });
    expect(adminAuth.accessToken).toBe('admin-token-1');
    expect(adminAuth.profile).toEqual({ email: 'admin@example.com' });
  });

  it('returns to the protected redirect after a successful login', async () => {
    const { router, wrapper } = await mountLogin('/login?redirect=/orders');

    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/orders');
    expect(elementPlusMocks.success).toHaveBeenCalledWith('登录成功');
  });

  it('keeps API errors visible without navigating away', async () => {
    const { router, wrapper } = await mountLogin();
    loginEndpoint.mockRejectedValue(new Error('管理员凭据无效'));

    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/login');
    expect(elementPlusMocks.error).toHaveBeenCalledWith('管理员凭据无效');
  });
});
