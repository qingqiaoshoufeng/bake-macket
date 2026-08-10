import type {
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserStatusView,
  AdminUserView,
  CreatePlaceholderUserRequest,
  GrantOperatorRequest,
  RevokeOperatorRequest,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

function toSearchParams(query: AdminUserListQuery): URLSearchParams {
  return new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );
}

export const usersApi = {
  list(query: AdminUserListQuery): Promise<AdminUserListResult> {
    return apiClient.get(`/admin/users?${toSearchParams(query).toString()}`);
  },
  create(body: CreatePlaceholderUserRequest): Promise<AdminUserView> {
    return apiClient.post('/admin/users', body);
  },
  grantOperator(
    userId: string,
    body: GrantOperatorRequest,
  ): Promise<AdminUserStatusView> {
    return apiClient.post(`/admin/users/${userId}/operator/grant`, body);
  },
  revokeOperator(
    userId: string,
    body: RevokeOperatorRequest,
  ): Promise<AdminUserStatusView> {
    return apiClient.post(`/admin/users/${userId}/operator/revoke`, body);
  },
};
