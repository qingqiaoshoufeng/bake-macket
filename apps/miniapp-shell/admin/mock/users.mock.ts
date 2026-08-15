import type { AdminUserListResult } from '@bake-mall/contracts';

export const ADMIN_USERS_MOCK: AdminUserListResult = Object.freeze({
  items: [
    {
      id: 'mock-user',
      nickname: '体验用户',
      identityPhoneMasked: '138****0000',
      identityPhoneVerified: true,
      wechatBound: true,
      loginPhoneMasked: null,
      createdAt: '2026-08-06T00:00:00.000Z',
      isOperator: false,
      operatorActive: false,
      mustChangePassword: false,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
});
