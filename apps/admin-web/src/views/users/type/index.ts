import type {
  AdminUserDetailView,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserStatusView,
  AdminUserView,
  CreatePlaceholderUserRequest,
  GrantOperatorRequest,
  RevokeOperatorRequest,
} from '@bake-mall/contracts';

export type {
  AdminUserDetailView,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserStatusView,
  AdminUserView,
  CreatePlaceholderUserRequest,
  GrantOperatorRequest,
  RevokeOperatorRequest,
};

export type CreateUserForm = {
  readonly phone: string;
};

export type OperatorGrantForm = GrantOperatorRequest;

export type OperatorRevokeForm = RevokeOperatorRequest & {
  readonly acknowledged: boolean;
};
