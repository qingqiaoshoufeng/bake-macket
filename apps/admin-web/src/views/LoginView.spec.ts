import { readFileSync } from 'node:fs';

import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import {
  AdminRole,
  ApiErrorCode,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  type AdminSessionView,
} from '@bake-mall/contracts';

import { ApiClientError } from '../api/http.js';
import { useAdminAuthStore } from '../stores/admin-auth.js';
import LoginView from './LoginView.vue';

const elementPlusMocks = vi.hoisted(() => ({
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
const loginEndpoint = vi.hoisted(() => vi.fn());

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
      {
        path: '/admin-password',
        component: { template: '<div>admin password</div>' },
      },
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
  window.sessionStorage.clear();
  loginEndpoint.mockResolvedValue({
    accessToken: 'admin-token-1',
    expiresAt: '2026-07-19T12:00:00.000Z',
    role: AdminRole.SUPER_ADMIN,
    permissions: SUPER_ADMIN_PERMISSIONS,
    mustChangePassword: false,
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

  it('submits only the selected SUPER_ADMIN union branch and applies the complete session', async () => {
    const { pinia, wrapper } = await mountLogin();
    const adminAuth = useAdminAuthStore(pinia);

    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(loginEndpoint).toHaveBeenCalledWith({
      kind: 'SUPER_ADMIN',
      email: 'admin@example.com',
      password: 'admin-password',
    });
    expect(adminAuth.session).toMatchObject({
      accessToken: 'admin-token-1',
      role: AdminRole.SUPER_ADMIN,
      mustChangePassword: false,
    });
    expect(adminAuth.profile).toEqual({ identifier: 'admin@example.com' });
  });

  it('submits only the selected OPERATOR union branch and routes to orders', async () => {
    loginEndpoint.mockResolvedValue({
      accessToken: 'operator-token',
      expiresAt: '2026-07-19T12:00:00.000Z',
      role: AdminRole.OPERATOR,
      permissions: OPERATOR_PERMISSIONS,
      mustChangePassword: false,
    });
    const { router, wrapper } = await mountLogin();

    await wrapper
      .get('[data-testid="admin-login-kind-operator"]')
      .trigger('click');
    await wrapper.get('[data-testid="admin-phone"]').setValue(' 13800000000 ');
    await wrapper
      .get('[data-testid="admin-login-password"]')
      .setValue('operator-password');
    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(loginEndpoint).toHaveBeenCalledWith({
      kind: 'OPERATOR',
      phone: '13800000000',
      password: 'operator-password',
    });
    expect(loginEndpoint.mock.calls[0]?.[0]).not.toHaveProperty('email');
    expect(router.currentRoute.value.fullPath).toBe('/orders');
  });

  it('forces a restricted operator session to the password page', async () => {
    loginEndpoint.mockResolvedValue({
      accessToken: 'restricted-token',
      expiresAt: '2026-07-19T12:00:00.000Z',
      role: AdminRole.OPERATOR,
      permissions: [],
      mustChangePassword: true,
    });
    const { router, wrapper } = await mountLogin();

    await wrapper
      .get('[data-testid="admin-login-kind-operator"]')
      .trigger('click');
    await wrapper.get('[data-testid="admin-phone"]').setValue('13800000000');
    await wrapper
      .get('[data-testid="admin-login-password"]')
      .setValue('temporary-password');
    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/admin-password');
  });

  it('marks the password input as the current password and never exposes an unknown server message or submitted secret', async () => {
    const submittedSecret = 's3cr3t-value';
    const upstreamMessage = `服务端记录了提交值 ${submittedSecret}`;
    const { wrapper } = await mountLogin();
    loginEndpoint.mockRejectedValue(
      new ApiClientError(500, upstreamMessage, {
        code: ApiErrorCode.ADMIN_PERMISSION_DENIED,
      }),
    );

    expect(
      wrapper
        .get('[data-testid="admin-login-password"]')
        .attributes('autocomplete'),
    ).toBe('current-password');
    await wrapper
      .get('[data-testid="admin-login-password"]')
      .setValue(submittedSecret);
    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(elementPlusMocks.error).toHaveBeenCalledWith('登录失败，请稍后重试');
    expect(elementPlusMocks.error).not.toHaveBeenCalledWith(upstreamMessage);
    expect(JSON.stringify(elementPlusMocks.error.mock.calls)).not.toContain(
      submittedSecret,
    );
  });

  it.each([
    {
      code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      expected: '账号或密码错误',
    },
    {
      code: ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
      expected: '尝试次数过多，请稍后重试',
    },
  ])(
    'maps login API code $code to fixed copy without exposing its message',
    async ({ code, expected }) => {
      const submittedSecret = 'allowlist-secret';
      const upstreamMessage = `服务端记录了提交值 ${submittedSecret}`;
      loginEndpoint.mockRejectedValue(
        new ApiClientError(401, upstreamMessage, { code }),
      );
      const { wrapper } = await mountLogin();

      await wrapper
        .get('[data-testid="admin-login-password"]')
        .setValue(submittedSecret);
      await wrapper.get('form').trigger('submit.prevent');
      await flushPromises();

      expect(elementPlusMocks.error).toHaveBeenCalledWith(expected);
      expect(elementPlusMocks.error).not.toHaveBeenCalledWith(upstreamMessage);
      expect(JSON.stringify(elementPlusMocks.error.mock.calls)).not.toContain(
        submittedSecret,
      );
    },
  );

  it('returns to the protected redirect after a successful login', async () => {
    const { router, wrapper } = await mountLogin('/login?redirect=/orders');

    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/orders');
    expect(elementPlusMocks.success).toHaveBeenCalledWith('登录成功');
  });

  it('keeps unknown errors safe without navigating away', async () => {
    const { router, wrapper } = await mountLogin();
    loginEndpoint.mockRejectedValue(new Error('管理员凭据无效'));

    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/login');
    expect(elementPlusMocks.error).toHaveBeenCalledWith('登录失败，请稍后重试');
  });

  it('keeps the latest successful attempt when an older attempt resolves later', async () => {
    const older = deferred<AdminSessionView>();
    const latest = deferred<AdminSessionView>();
    loginEndpoint
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);
    const { pinia, router, wrapper } = await mountLogin();
    const adminAuth = useAdminAuthStore(pinia);

    await wrapper.get('form').trigger('submit.prevent');
    await wrapper
      .get('[data-testid="admin-email"]')
      .setValue('latest@example.com');
    await wrapper.get('form').trigger('submit.prevent');

    latest.resolve({
      accessToken: 'latest-token',
      expiresAt: '2026-08-06T12:00:00.000Z',
      role: AdminRole.SUPER_ADMIN,
      permissions: SUPER_ADMIN_PERMISSIONS,
      mustChangePassword: false,
    });
    await flushPromises();

    expect(adminAuth.accessToken).toBe('latest-token');
    expect(adminAuth.profile).toEqual({ identifier: 'latest@example.com' });
    expect(router.currentRoute.value.fullPath).toBe('/dashboard');
    expect(elementPlusMocks.success).toHaveBeenCalledTimes(1);

    older.resolve({
      accessToken: 'older-token',
      expiresAt: '2026-08-06T12:00:00.000Z',
      role: AdminRole.OPERATOR,
      permissions: [],
      mustChangePassword: true,
    });
    await flushPromises();

    expect(adminAuth.accessToken).toBe('latest-token');
    expect(adminAuth.profile).toEqual({ identifier: 'latest@example.com' });
    expect(router.currentRoute.value.fullPath).toBe('/dashboard');
    expect(elementPlusMocks.success).toHaveBeenCalledTimes(1);
    expect(elementPlusMocks.error).not.toHaveBeenCalled();
  });

  it('ignores an older failure and does not clear the latest submitting state', async () => {
    const older = deferred<AdminSessionView>();
    const latest = deferred<AdminSessionView>();
    loginEndpoint
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);
    const { pinia, router, wrapper } = await mountLogin();
    const adminAuth = useAdminAuthStore(pinia);

    await wrapper.get('form').trigger('submit.prevent');
    await wrapper
      .get('[data-testid="admin-email"]')
      .setValue('latest@example.com');
    await wrapper.get('form').trigger('submit.prevent');

    older.reject(new Error('旧请求失败'));
    await flushPromises();

    expect(wrapper.get('[data-testid="admin-submit"]').text()).toContain(
      '登录中',
    );
    expect(elementPlusMocks.error).not.toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe('/login');

    latest.resolve({
      accessToken: 'latest-token',
      expiresAt: '2026-08-06T12:00:00.000Z',
      role: AdminRole.SUPER_ADMIN,
      permissions: SUPER_ADMIN_PERMISSIONS,
      mustChangePassword: false,
    });
    await flushPromises();

    expect(adminAuth.accessToken).toBe('latest-token');
    expect(adminAuth.profile).toEqual({ identifier: 'latest@example.com' });
    expect(router.currentRoute.value.fullPath).toBe('/dashboard');
    expect(wrapper.get('[data-testid="admin-submit"]').text()).toContain(
      '登录店长后台',
    );
    expect(elementPlusMocks.error).not.toHaveBeenCalled();
  });
});
