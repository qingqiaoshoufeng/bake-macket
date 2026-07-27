import type {
  CreateMembershipPurchaseRequest,
  MemberCreditEntryView,
  MembershipOverviewView,
  MembershipPurchaseView,
  PublicMembershipLevelView,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

const idempotencyHeaders = (key: string): HeadersInit => ({
  'Idempotency-Key': key,
});

export const membershipFeatureApi = {
  listLevels: (): Promise<PublicMembershipLevelView[]> =>
    apiClient.get('/public/membership-levels'),
  getLevel: (id: string): Promise<PublicMembershipLevelView> =>
    apiClient.get(`/public/membership-levels/${id}`),
  getOverview: (): Promise<MembershipOverviewView> =>
    apiClient.get('/me/membership'),
  listPurchases: (): Promise<MembershipPurchaseView[]> =>
    apiClient.get('/me/membership/purchases'),
  listCreditEntries: (): Promise<MemberCreditEntryView[]> =>
    apiClient.get('/me/membership/credit-entries'),
  createPurchase: (
    request: CreateMembershipPurchaseRequest,
    idempotencyKey: string,
  ): Promise<MembershipPurchaseView> =>
    apiClient.post('/me/membership/purchases', request, {
      headers: idempotencyHeaders(idempotencyKey),
    }),
  simulatePayment: (
    purchaseId: string,
    idempotencyKey: string,
  ): Promise<MembershipPurchaseView> =>
    apiClient.post(
      `/me/membership/purchases/${purchaseId}/simulate-payment`,
      undefined,
      { headers: idempotencyHeaders(idempotencyKey) },
    ),
};
