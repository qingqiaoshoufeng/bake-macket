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
    getOne: vi.fn(),
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
  it('opens complete WeChat identity detail without unrelated secrets', async () => {
    api.list.mockResolvedValue({
      items: [
        {
          id: 'user-1',
          nickname: '小莓',
          identityPhoneMasked: '138****0000',
          identityPhoneVerified: true,
          wechatBound: true,
          wechatOpenid: 'openid-user',
          wechatUnionid: 'unionid-user',
          loginPhoneMasked: null,
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
    api.getOne.mockResolvedValue({
      id: 'user-1',
      nickname: '小莓',
      avatarUrl: 'https://cdn.example.com/avatar.webp',
      wechat: {
        bound: true,
        openidBound: true,
        unionidBound: false,
        openid: 'openid-user',
        unionid: null,
      },
      identityPhone: { masked: '138****0000', verified: true },
      account: { isActive: true, mergedIntoUserId: null },
      operator: {
        isOperator: false,
        active: false,
        mustChangePassword: false,
        loginPhoneMasked: null,
      },
      createdAt: '2026-08-06T08:00:00.000Z',
      updatedAt: '2026-08-07T08:00:00.000Z',
    });

    const wrapper = mountView(superSession);
    await flushPromises();
    await wrapper.find('[data-testid="view-user-detail"]').trigger('click');
    await flushPromises();

    expect(api.getOne).toHaveBeenCalledWith('user-1');
    expect(wrapper.text()).toContain('用户详情');
    expect(wrapper.text()).toContain('openid-user');
    expect(wrapper.text()).toContain('UnionID');
    expect(wrapper.text()).toContain('未获取');
    expect(wrapper.text()).toContain('138****0000');
    expect(wrapper.text()).not.toContain('openid-secret');
  });

  it('shows create and role controls to SUPER_ADMIN', async () => {
    api.list.mockResolvedValue({
      items: [
        {
          id: 'user-1',
          nickname: '小莓',
          identityPhoneMasked: '138****0000',
          identityPhoneVerified: true,
          wechatBound: true,
          wechatOpenid: 'openid-user',
          wechatUnionid: 'unionid-user',
          loginPhoneMasked: null,
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

  it('展示微信、身份手机号和独立管理员登录手机号，并禁用未绑定微信授权', async () => {
    api.list.mockResolvedValue({
      items: [
        {
          id: 'user-bound',
          nickname: '已绑定用户',
          identityPhoneMasked: '138****0000',
          identityPhoneVerified: true,
          wechatBound: true,
          wechatOpenid: 'openid-user',
          wechatUnionid: 'unionid-user',
          loginPhoneMasked: '137****0000',
          createdAt: '2026-08-06T08:00:00.000Z',
          isOperator: true,
          operatorActive: false,
          mustChangePassword: false,
        },
        {
          id: 'user-unbound',
          nickname: '未绑定用户',
          identityPhoneMasked: null,
          identityPhoneVerified: false,
          wechatBound: false,
          wechatOpenid: null,
          wechatUnionid: null,
          loginPhoneMasked: null,
          createdAt: '2026-08-06T08:00:00.000Z',
          isOperator: false,
          operatorActive: false,
          mustChangePassword: false,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });

    const wrapper = mountView(superSession);
    await flushPromises();

    expect(wrapper.text()).toContain('身份手机号');
    expect(wrapper.text()).toContain('管理员登录手机号');
    expect(wrapper.text()).toContain('微信已绑定');
    expect(wrapper.text()).toContain('微信未绑定');
    expect(wrapper.text()).toContain('openid-user');
    expect(wrapper.text()).toContain('unionid-user');
    expect(wrapper.text()).toContain('未获取');
    expect(wrapper.text()).toContain('137****0000');
    const grantButtons = wrapper.findAll('[data-testid="grant-operator"]');
    expect(grantButtons).toHaveLength(2);
    expect(grantButtons[0]?.attributes('disabled')).toBeUndefined();
    expect(grantButtons[1]?.attributes('disabled')).toBeDefined();
  });

  it('gives the search input an accessible name', async () => {
    const wrapper = mountView(superSession);
    await flushPromises();

    expect(wrapper.find('input[aria-label="搜索用户"]').exists()).toBe(true);
  });

  it('授权弹窗说明管理员登录手机号独立且包含 11 位输入', async () => {
    api.list.mockResolvedValue({
      items: [
        {
          id: 'user-1',
          nickname: '小莓',
          identityPhoneMasked: '138****0000',
          identityPhoneVerified: true,
          wechatBound: true,
          wechatOpenid: 'openid-user',
          wechatUnionid: 'unionid-user',
          loginPhoneMasked: null,
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
    await wrapper.find('[data-testid="grant-operator"]').trigger('click');

    expect(wrapper.text()).toContain('管理员登录手机号');
    expect(wrapper.text()).toContain(
      '与顾客身份手机号、订单联系手机号相互独立',
    );
    expect(wrapper.find('[data-testid="operator-login-phone"]').exists()).toBe(
      true,
    );
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
            identityPhoneMasked: '138****0000',
            identityPhoneVerified: true,
            wechatBound: true,
            wechatOpenid: 'openid-user',
            wechatUnionid: 'unionid-user',
            loginPhoneMasked: null,
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
          identityPhoneMasked: '138****0000',
          identityPhoneVerified: true,
          wechatBound: true,
          wechatOpenid: 'openid-user',
          wechatUnionid: 'unionid-user',
          loginPhoneMasked: null,
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
