import {
  AdminRole,
  ApiErrorCode,
  OPERATOR_PERMISSIONS,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../api/http.js';
import { useAdminAuthStore } from '../../stores/admin-auth.js';
import AdminPasswordView from './AdminPasswordView.vue';

const passwordApi = vi.hoisted(() => ({
  changeInitial: vi.fn(),
  changeCurrent: vi.fn(),
}));
const messages = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./api/index.js', () => ({
  changeInitialAdminPassword: passwordApi.changeInitial,
  changeAdminPassword: passwordApi.changeCurrent,
}));

vi.mock('element-plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('element-plus')>()),
  ElMessage: messages,
}));

const restrictedSession: AdminSessionView = {
  accessToken: 'restricted-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: [],
  mustChangePassword: true,
};

const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

const submittedCurrentSecret = '741852';
const submittedNewSecret = '963852';

async function submitPasswordForm(wrapper: ReturnType<typeof mount>) {
  await wrapper
    .get('[data-testid="admin-current-password"]')
    .setValue(submittedCurrentSecret);
  await wrapper
    .get('[data-testid="admin-new-password"]')
    .setValue(submittedNewSecret);
  await wrapper
    .get('[data-testid="admin-confirm-password"]')
    .setValue(submittedNewSecret);
  await wrapper.get('form').trigger('submit.prevent');
  await flushPromises();
}

async function mountPasswordView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAdminAuthStore(pinia).applySession(restrictedSession, {
    identifier: '13800000000',
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin-password', component: AdminPasswordView },
      { path: '/orders', component: { template: '<div>orders</div>' } },
    ],
  });
  await router.push('/admin-password');
  await router.isReady();
  return {
    router,
    wrapper: mount(AdminPasswordView, {
      global: { plugins: [pinia, router] },
    }),
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe('AdminPasswordView', () => {
  it('renders the three-field initial password form', async () => {
    const { wrapper } = await mountPasswordView();

    expect(wrapper.text()).toContain('首次修改密码');
    expect(wrapper.text()).toContain('临时密码');
    expect(
      wrapper
        .get('[data-testid="admin-current-password"]')
        .attributes('autocomplete'),
    ).toBe('current-password');
    expect(
      wrapper
        .get('[data-testid="admin-new-password"]')
        .attributes('autocomplete'),
    ).toBe('new-password');
    expect(
      wrapper
        .get('[data-testid="admin-confirm-password"]')
        .attributes('autocomplete'),
    ).toBe('new-password');
  });

  it('applies the new session and enters orders after a successful change', async () => {
    passwordApi.changeInitial.mockResolvedValue(operatorSession);
    const { router, wrapper } = await mountPasswordView();

    await submitPasswordForm(wrapper);

    expect(router.currentRoute.value.fullPath).toBe('/orders');
    expect(messages.success).toHaveBeenCalledWith('密码修改成功');
  });

  it.each([
    {
      code: ApiErrorCode.ADMIN_PASSWORD_POLICY_VIOLATION,
      expected: '新密码不符合要求，请使用至少 6 位数字',
    },
    {
      code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      expected: '当前密码不正确',
    },
    {
      code: ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
      expected: '尝试次数过多，请稍后重试',
    },
    {
      code: ApiErrorCode.ADMIN_PASSWORD_CHANGE_REQUIRED,
      expected: '当前会话不支持此操作，请重新登录',
    },
    {
      code: ApiErrorCode.ADMIN_PERMISSION_DENIED,
      expected: '密码修改失败，请稍后重试',
    },
    {
      code: undefined,
      expected: '密码修改失败，请稍后重试',
    },
  ])(
    'maps API code $code to fixed copy without exposing its message',
    async ({ code, expected }) => {
      const upstreamMessage = `服务端返回了提交值 ${submittedCurrentSecret} 和 ${submittedNewSecret}`;
      passwordApi.changeInitial.mockRejectedValue(
        new ApiClientError(400, upstreamMessage, { code }),
      );
      const { wrapper } = await mountPasswordView();

      await submitPasswordForm(wrapper);

      expect(messages.error).toHaveBeenCalledWith(expected);
      expect(messages.error).not.toHaveBeenCalledWith(upstreamMessage);
      expect(JSON.stringify(messages.error.mock.calls)).not.toContain(
        submittedCurrentSecret,
      );
      expect(JSON.stringify(messages.error.mock.calls)).not.toContain(
        submittedNewSecret,
      );
    },
  );
});
