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
  phoneMasked: string | null;
  phoneVerified: boolean;
  createdAt: string;
  isOperator: boolean;
  operatorActive: boolean;
  mustChangePassword: boolean;
};

export type AdminUserListItem = AdminUserView;

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
  currentPassword: string;
  temporaryPassword: string;
  confirmTemporaryPassword: string;
};

export type RevokeOperatorRequest = {
  currentPassword: string;
};
