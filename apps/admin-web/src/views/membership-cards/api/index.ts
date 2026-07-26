import type {
  AdminMembershipLevelDetailView,
  AdminMembershipLevelListQuery,
  AdminMembershipLevelListResult,
  MembershipLevelStatus,
  SaveMembershipLevelRequest,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

function toSearchParams(query: AdminMembershipLevelListQuery): URLSearchParams {
  return new URLSearchParams(
    Object.entries(query)
      .filter((entry): entry is [string, string | number] => {
        const value = entry[1];
        return value !== undefined && value !== '';
      })
      .map(([key, value]) => [key, String(value)]),
  );
}

export const membershipCardsApi = {
  list: (
    query: AdminMembershipLevelListQuery,
  ): Promise<AdminMembershipLevelListResult> => {
    const params = toSearchParams(query).toString();
    return apiClient.get(
      `/admin/membership-levels${params ? `?${params}` : ''}`,
    );
  },
  getOne: (id: string): Promise<AdminMembershipLevelDetailView> =>
    apiClient.get(`/admin/membership-levels/${id}`),
  create: (
    body: SaveMembershipLevelRequest,
  ): Promise<AdminMembershipLevelDetailView> =>
    apiClient.post('/admin/membership-levels', body),
  update: (
    id: string,
    body: SaveMembershipLevelRequest,
  ): Promise<AdminMembershipLevelDetailView> =>
    apiClient.put(`/admin/membership-levels/${id}`, body),
  updateStatus: (
    id: string,
    status: MembershipLevelStatus,
    version: number,
  ): Promise<AdminMembershipLevelDetailView> =>
    apiClient.patch(`/admin/membership-levels/${id}/status`, {
      status,
      version,
    }),
  remove: (id: string): Promise<void> =>
    apiClient.delete(`/admin/membership-levels/${id}`),
};
