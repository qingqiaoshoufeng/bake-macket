import {
  AdminRole,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAdminAuthStore } from '../../stores/admin-auth.js';
import { usersApi } from './api/index.js';
import UsersView from './UsersView.vue';

vi.mock('./api/index.js', () => ({
  usersApi: {
    list: vi.fn(),
    create: vi.fn(),
    grantOperator: vi.fn(),
    revokeOperator: vi.fn(),
  },
}));

const api = vi.mocked(usersApi);
const superSession: AdminSessionView = {
  accessToken: 'super-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  role: AdminRole.SUPER_ADMIN,
  permissions: SUPER_ADMIN_PERMISSIONS,
  mustChangePassword: false,
};
const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

function mountView(
  session: AdminSessionView,
  errorHandler = vi.fn<(error: unknown) => void>(),
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAdminAuthStore(pinia).applySession(session, { identifier: 'admin' });
  return mount(UsersView, {
    global: {
      plugins: [pinia],
      directives: { loading: () => undefined },
      config: { errorHandler },
    },
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
  api.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
});

describe('UsersView', () => {
  it('shows create and role controls to SUPER_ADMIN', async () => {
    api.list.mockResolvedValue({
      items: [
        {
          id: 'user-1',
          nickname: '小莓',
          phoneMasked: '138****0000',
          phoneVerified: true,
          createdAt: '2026-08-06T08:00:00.000Z',
          isOperator: false,
          operatorActive: false,
          mustChangePassword: false,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const wrapper = mountView(superSession);
    await flushPromises();

    expect(wrapper.find('[data-testid="open-create-user"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="grant-operator"]').exists()).toBe(true);
  });

  it('gives the search input an accessible name', async () => {
    const wrapper = mountView(superSession);
    await flushPromises();

    expect(wrapper.find('input[aria-label="搜索用户"]').exists()).toBe(true);
  });

  it.each([
    ['current-page', 2],
    ['page-size', 50],
  ] as const)(
    'catches rejected pagination %s events without an unhandled component error',
    async (eventName, value) => {
      api.list.mockResolvedValueOnce({
        items: [
          {
            id: 'user-1',
            nickname: '小莓',
            phoneMasked: '138****0000',
            phoneVerified: true,
            createdAt: '2026-08-06T08:00:00.000Z',
            isOperator: false,
            operatorActive: false,
            mustChangePassword: false,
          },
        ],
        total: 21,
        page: 1,
        pageSize: 20,
      });
      const errorHandler = vi.fn<(error: unknown) => void>();
      const wrapper = mountView(superSession, errorHandler);
      await flushPromises();
      api.list.mockRejectedValueOnce(new Error('network details'));

      wrapper
        .findComponent({ name: 'ElPagination' })
        .vm.$emit(`update:${eventName}`, value);
      await flushPromises();

      expect(errorHandler).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('用户列表加载失败，请稍后重试');
    },
  );

  it('lets OPERATOR read and create but hides all role management controls', async () => {
    api.list.mockResolvedValue({
      items: [
        {
          id: 'user-1',
          nickname: '小莓',
          phoneMasked: '138****0000',
          phoneVerified: true,
          createdAt: '2026-08-06T08:00:00.000Z',
          isOperator: true,
          operatorActive: true,
          mustChangePassword: false,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const wrapper = mountView(operatorSession);
    await flushPromises();

    expect(wrapper.find('[data-testid="open-create-user"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="grant-operator"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="revoke-operator"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain('仅查看');
  });
});
