import type { AdminUserListResult } from '@bake-mall/contracts';

export const ADMIN_USERS_MOCK: AdminUserListResult = Object.freeze({
  items: [
    {
      id: 'mock-user',
      nickname: '体验用户',
      phoneMasked: '138****0000',
      phoneVerified: true,
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
