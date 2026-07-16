import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { useAdminAuthStore } from '../stores/admin-auth.js';
import LoginView from './LoginView.vue';

vi.mock('./login/config/default-admin-login.js', () => ({
  getDefaultAdminLogin: () => ({
    email: 'admin@example.com',
    password: 'admin-password',
  }),
}));

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>();

  return {
    ...actual,
    ElMessage: {
      warning: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

const mountLogin = async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
    ],
  });
  await router.push('/login');
  await router.isReady();

  return {
    pinia,
    router,
    wrapper: mount(LoginView, {
      global: { plugins: [pinia, router] },
    }),
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginView', () => {
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

  it('submits the rendered credentials through the admin auth store', async () => {
    const { pinia, wrapper } = await mountLogin();
    const adminAuth = useAdminAuthStore(pinia);
    const login = vi.fn().mockResolvedValue(undefined);
    adminAuth.loginAsAdmin = login;

    await wrapper.get('form').trigger('submit.prevent');

    expect(login).toHaveBeenCalledWith('admin@example.com', 'admin-password');
  });
});
