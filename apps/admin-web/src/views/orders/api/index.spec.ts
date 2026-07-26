import {
  BooleanFilter,
  FulfillmentType,
  OrderStatus,
  type AdminOrderListQuery,
} from '@bake-mall/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../../api/http.js';
import { ordersApi } from './index.js';

vi.mock('../../../api/http.js', () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

const client = vi.mocked(apiClient);
const query: AdminOrderListQuery = {
  orderNo: 'BM2026',
  contact: '张三 138',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  userId: 'user-1',
  itemQ: '草莓 6寸',
  usesMembership: BooleanFilter.YES,
  usesCredit: BooleanFilter.NO,
  hasRemark: BooleanFilter.YES,
  minPayableCents: 1230,
  maxPayableCents: 10000,
  createdAtFrom: '2026-07-01T00:00:00.000Z',
  createdAtBefore: '2026-08-01T00:00:00.000Z',
  page: 2,
  pageSize: 100,
};

describe('ordersApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serializes every list filter and keeps zero-valued ranges', async () => {
    await ordersApi.list({ ...query, minPayableCents: 0 });

    expect(client.get).toHaveBeenCalledWith(
      '/admin/orders?orderNo=BM2026&contact=%E5%BC%A0%E4%B8%89+138&status=NEW&fulfillmentType=PICKUP&userId=user-1&itemQ=%E8%8D%89%E8%8E%93+6%E5%AF%B8&usesMembership=YES&usesCredit=NO&hasRemark=YES&minPayableCents=0&maxPayableCents=10000&createdAtFrom=2026-07-01T00%3A00%3A00.000Z&createdAtBefore=2026-08-01T00%3A00%3A00.000Z&page=2&pageSize=100',
    );
  });
});
