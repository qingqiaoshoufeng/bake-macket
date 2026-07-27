import {
  BooleanFilter,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  type AdminMembershipPurchaseListQuery,
} from '@bake-mall/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../../api/http.js';
import { membershipPurchasesApi } from './index.js';

vi.mock('../../../api/http.js', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const client = vi.mocked(apiClient);
const query: AdminMembershipPurchaseListQuery = {
  purchaseNo: 'MP2026',
  userPhone: '13800000000',
  levelId: 'level-1',
  status: MembershipPurchaseStatus.FULFILLED,
  paymentStatus: MembershipPaymentStatus.SUCCEEDED,
  minPriceCents: 29,
  maxPriceCents: 9990,
  voidable: BooleanFilter.YES,
  createdAtFrom: '2026-07-01T00:00:00.000Z',
  createdAtBefore: '2026-08-01T00:00:00.000Z',
  page: 2,
  pageSize: 20,
};

describe('membershipPurchasesApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('composes purchase list, detail, and void endpoints', async () => {
    await membershipPurchasesApi.list(query);
    await membershipPurchasesApi.getOne('purchase-1');
    await membershipPurchasesApi.voidPurchase('purchase-1');

    expect(client.get).toHaveBeenNthCalledWith(
      1,
      '/admin/membership-purchases?purchaseNo=MP2026&userPhone=13800000000&levelId=level-1&status=FULFILLED&paymentStatus=SUCCEEDED&minPriceCents=29&maxPriceCents=9990&voidable=YES&createdAtFrom=2026-07-01T00%3A00%3A00.000Z&createdAtBefore=2026-08-01T00%3A00%3A00.000Z&page=2&pageSize=20',
    );
    expect(client.get).toHaveBeenNthCalledWith(
      2,
      '/admin/membership-purchases/purchase-1',
    );
    expect(client.post).toHaveBeenCalledWith(
      '/admin/membership-purchases/purchase-1/void',
    );
  });
});
