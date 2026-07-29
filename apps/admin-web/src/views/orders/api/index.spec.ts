import {
  AdminOrderExportView,
  BooleanFilter,
  FulfillmentType,
  OrderStatus,
  type AdminOrderListQuery,
  type AdminOrderSupplyDetailQuery,
  type AdminOrderSupplyQuery,
} from '@bake-mall/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../../api/http.js';
import { ordersApi } from './index.js';

vi.mock('../../../api/http.js', () => ({
  apiClient: {
    get: vi.fn(),
    getBlob: vi.fn(),
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

  it('appends repeated supplyStatuses and compacts non-array values', async () => {
    const supplyQuery: AdminOrderSupplyQuery = {
      contact: ' ',
      minPayableCents: 0,
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      page: 1,
      pageSize: 20,
    };

    await ordersApi.listSupply(supplyQuery);

    expect(client.get).toHaveBeenCalledWith(
      '/admin/orders/supply?minPayableCents=0&supplyStatuses=NEW&supplyStatuses=PROCESSING&page=1&pageSize=20',
    );
  });

  it('encodes opaque detail group keys in the query without mapping the DTO', async () => {
    const detailQuery: AdminOrderSupplyDetailQuery = {
      groupKey: 'SKU/草莓?6寸',
      supplyStatuses: [OrderStatus.NEW],
      page: 2,
      pageSize: 50,
    };

    await ordersApi.listSupplyItems(detailQuery);

    expect(client.get).toHaveBeenCalledWith(
      '/admin/orders/supply-items?groupKey=SKU%2F%E8%8D%89%E8%8E%93%3F6%E5%AF%B8&supplyStatuses=NEW&page=2&pageSize=50',
    );
  });

  it('exports a query without introducing pagination', async () => {
    await ordersApi.export({
      view: AdminOrderExportView.SUPPLY,
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
    });

    expect(client.getBlob).toHaveBeenCalledWith(
      '/admin/orders/export?view=SUPPLY&supplyStatuses=NEW&supplyStatuses=PROCESSING',
    );
  });

  it('encodes ids used in path segments', async () => {
    await ordersApi.getOne('order/with?reserved');
    await ordersApi.updateStatus('order/with?reserved', OrderStatus.PROCESSING);

    expect(client.get).toHaveBeenCalledWith(
      '/admin/orders/order%2Fwith%3Freserved',
    );
    expect(client.patch).toHaveBeenCalledWith(
      '/admin/orders/order%2Fwith%3Freserved/status',
      { status: OrderStatus.PROCESSING },
    );
  });
});
