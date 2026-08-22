import type { AdminPageQuery, PaginatedView } from './admin-list.js';
import { AdminRole } from './enums.js';

export type AdminOperatorStatusView = {
  adminUserId: string;
  role: AdminRole.OPERATOR;
  isActive: boolean;
  mustChangePassword: boolean;
};

export type AdminUserView = {
  id: string;
  nickname: string | null;
  identityPhoneMasked: string | null;
  identityPhoneVerified: boolean;
  wechatBound: boolean;
  wechatOpenid: string | null;
  wechatUnionid: string | null;
  loginPhoneMasked: string | null;
  createdAt: string;
  isOperator: boolean;
  operatorActive: boolean;
  mustChangePassword: boolean;
};

export type AdminUserListItem = AdminUserView;

export type AdminUserDetailView = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  wechat: {
    bound: boolean;
    openidBound: boolean;
    unionidBound: boolean;
    openid: string | null;
    unionid: string | null;
  };
  identityPhone: {
    masked: string | null;
    verified: boolean;
  };
  account: {
    isActive: boolean;
    mergedIntoUserId: string | null;
  };
  operator: {
    isOperator: boolean;
    active: boolean;
    mustChangePassword: boolean;
    loginPhoneMasked: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type AdminUserListQuery = AdminPageQuery & {
  /** Matches normalized phone, nickname, or exact user ID. */
  q?: string;
};

export type AdminUserPage = PaginatedView<AdminUserView>;
export type AdminUserListResult = AdminUserPage;

export type CreatePlaceholderUserRequest = {
  phone: string;
};

export type AdminUserStatusView = {
  userId: string;
  operator: AdminOperatorStatusView | null;
};

export type GrantOperatorRequest = {
  loginPhone: string;
  currentPassword: string;
  temporaryPassword: string;
  confirmTemporaryPassword: string;
};

export type RevokeOperatorRequest = {
  currentPassword: string;
};
