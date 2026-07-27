import type {
  AdminMembershipPurchaseDetailView,
  AdminMembershipPurchaseListQuery,
  AdminMembershipPurchaseListResult,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

function toSearchParams(
  query: AdminMembershipPurchaseListQuery,
): URLSearchParams {
  return new URLSearchParams(
    Object.entries(query)
      .filter((entry): entry is [string, string | number] => {
        const value = entry[1];
        return value !== undefined && value !== '';
      })
      .map(([key, value]) => [key, String(value)]),
  );
}

export const membershipPurchasesApi = {
  list: (
    query: AdminMembershipPurchaseListQuery,
  ): Promise<AdminMembershipPurchaseListResult> => {
    const params = toSearchParams(query).toString();
    return apiClient.get(`/admin/membership-purchases?${params}`);
  },
  getOne: (id: string): Promise<AdminMembershipPurchaseDetailView> =>
    apiClient.get(`/admin/membership-purchases/${id}`),
  voidPurchase: (id: string): Promise<AdminMembershipPurchaseDetailView> =>
    apiClient.post(`/admin/membership-purchases/${id}/void`),
};
