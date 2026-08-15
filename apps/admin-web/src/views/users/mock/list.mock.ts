import type { AdminUserListResult } from '../type/index.js';

export const USER_LIST_MOCK: AdminUserListResult = {
  items: [
    {
      id: '10001',
      nickname: '小莓',
      identityPhoneMasked: '138****0000',
      identityPhoneVerified: true,
      wechatBound: true,
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
};
