import type {
  AdminSessionView,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserView,
  ChangeAdminPasswordRequest,
  ChangeInitialOperatorPasswordRequest,
  CustomerAuthSessionView,
} from '@bake-mall/contracts';

export type {
  AdminSessionView,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserView,
  ChangeAdminPasswordRequest,
  ChangeInitialOperatorPasswordRequest,
  CustomerAuthSessionView,
};

export type AdminPasswordForm = Readonly<{
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}>;

export type AdminPasswordMode = 'current' | 'initial';

export type AdminAuthState = Readonly<{
  eligible: boolean;
  loading: boolean;
}>;

export type AdminUsersState = Readonly<{
  canCreate: boolean;
  createPhone: string;
  creating: boolean;
  error: string | null;
  loading: boolean;
  page: number;
  pageSize: number;
  query: string;
  total: number;
  users: readonly AdminUserView[];
}>;
