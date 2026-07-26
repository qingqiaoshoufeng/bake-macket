import {
  FulfillmentType,
  OrderStatus,
  type AdminOrderListItem,
  type OrderView,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ordersApi } from '../api/index.js';
import { useOrders } from './useOrders.js';

vi.mock('../api/index.js', () => ({
  ordersApi: {
    list: vi.fn(),
    getOne: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

const api = vi.mocked(ordersApi);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const row: AdminOrderListItem = {
  id: 'order-1',
  orderNo: 'BM2026071800000001',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '张三',
  contactPhone: '13800000000',
  goodsTotalCents: 6800,
  membershipDiscountCents: 0,
  creditAppliedCents: 0,
  payableTotalCents: 6800,
  createdAt: '2026-07-18T08:00:00.000Z',
  updatedAt: '2026-07-18T08:00:00.000Z',
};
const detail: OrderView = {
  ...row,
  membershipDiscountCents: 0,
  creditAppliedCents: 0,
  payableTotalCents: 6800,
  pricingVersion: 1,
  pickupTimeText: '2026-07-19 10:00',
  remark: '少糖',
  items: [
    {
      id: 'item-1',
      productName: '草莓蛋糕',
      skuName: '6 寸',
      skuAttributes: { size: '6寸' },
      unitPriceCents: 6800,
      quantity: 1,
      lineGoodsTotalCents: 6800,
      lineMembershipDiscountCents: 0,
      linePayableCents: 6800,
    },
  ],
};

describe('useOrders', () => {
  afterEach(() => vi.resetAllMocks());

  it('loads a paginated list with contract-defined filters', async () => {
    api.list.mockResolvedValueOnce({
      items: [row],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const state = useOrders();
    state.filters.orderNo = ' BM2026 ';
    state.filters.status = OrderStatus.NEW;
    state.filters.fulfillmentType = FulfillmentType.PICKUP;

    await state.search();

    expect(api.list).toHaveBeenCalledWith({
      orderNo: 'BM2026',
      status: OrderStatus.NEW,
      fulfillmentType: FulfillmentType.PICKUP,
      page: 1,
      pageSize: 20,
    });
    expect(state.orders.value).toEqual([row]);
    expect(state.total.value).toBe(1);
  });

  it('loads a read-only detail and exposes only legal actions', async () => {
    api.getOne.mockResolvedValueOnce(detail);
    const state = useOrders();

    await state.openDetail(row.id);

    expect(state.detail.value).toEqual(detail);
    expect(state.actions.value).toEqual([
      {
        key: 'start',
        status: OrderStatus.PROCESSING,
        label: '开始处理',
        description: '将订单状态从“待处理”切换为“处理中”,准备安排生产或发货。',
      },
    ]);
  });

  it('derives processing actions from the shared definitions including no-restock copy', async () => {
    api.getOne.mockResolvedValueOnce({
      ...detail,
      status: OrderStatus.PROCESSING,
    });
    const state = useOrders();

    await state.openDetail(row.id);

    expect(state.actions.value).toEqual([
      {
        key: 'complete',
        status: OrderStatus.COMPLETED,
        label: '完成订单',
        description: '订单已交付,标记为已完成。',
      },
      {
        key: 'cancel',
        status: OrderStatus.CANCELLED,
        label: '取消订单',
        description: '取消订单不会回补库存,请确认后再操作。',
      },
    ]);
  });

  it('keeps the latest list response and loading state when requests settle out of order', async () => {
    const oldRequest = deferred<Awaited<ReturnType<typeof ordersApi.list>>>();
    const newRequest = deferred<Awaited<ReturnType<typeof ordersApi.list>>>();
    api.list
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const state = useOrders();

    const oldLoad = state.setPage(2);
    const newLoad = state.setPage(3);
    newRequest.resolve({
      items: [{ ...row, id: 'order-new' }],
      page: 3,
      pageSize: 20,
      total: 1,
    });
    await newLoad;

    expect(state.orders.value.map(({ id }) => id)).toEqual(['order-new']);
    expect(state.page.value).toBe(3);
    expect(state.loading.value).toBe(false);

    oldRequest.resolve({
      items: [{ ...row, id: 'order-old' }],
      page: 2,
      pageSize: 20,
      total: 1,
    });
    await oldLoad;

    expect(state.orders.value.map(({ id }) => id)).toEqual(['order-new']);
    expect(state.page.value).toBe(3);
    expect(state.lastError.value).toBeNull();
  });

  it('ignores an obsolete list failure after a newer request succeeds', async () => {
    const oldRequest = deferred<Awaited<ReturnType<typeof ordersApi.list>>>();
    api.list
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce({ items: [row], page: 1, pageSize: 20, total: 1 });
    const state = useOrders();

    const oldLoad = state.load();
    await state.search();
    oldRequest.reject(new Error('旧请求失败'));
    await oldLoad;

    expect(state.orders.value).toEqual([row]);
    expect(state.lastError.value).toBeNull();
    expect(state.loading.value).toBe(false);
  });

  it('clears stale detail, ignores obsolete detail responses, and exposes latest failures', async () => {
    const oldRequest = deferred<OrderView>();
    const latestFailure = deferred<OrderView>();
    api.getOne
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(latestFailure.promise);
    const state = useOrders();
    state.detail.value = detail;

    const oldOpen = state.openDetail('order-old');
    expect(state.detail.value).toBeNull();
    const latestOpen = state.openDetail('order-new');
    latestFailure.reject(new Error('详情不可用'));
    await latestOpen;

    expect(state.detail.value).toBeNull();
    expect(state.actions.value).toEqual([]);
    expect(state.detailError.value).toBe('订单详情加载失败，请重试');
    expect(state.detailLoading.value).toBe(false);

    oldRequest.resolve(detail);
    await oldOpen;
    expect(state.detail.value).toBeNull();
    expect(state.detailError.value).toBe('订单详情加载失败，请重试');
  });

  it('updates status, preserves the no-restock result, and refreshes only the list', async () => {
    api.getOne.mockResolvedValueOnce({
      ...detail,
      status: OrderStatus.PROCESSING,
    });
    api.updateStatus.mockResolvedValueOnce({
      order: { ...detail, status: OrderStatus.CANCELLED },
      noRestock: true,
    });
    api.list.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    const state = useOrders();
    await state.openDetail(row.id);

    const result = await state.updateStatus(OrderStatus.CANCELLED);

    expect(result.noRestock).toBe(true);
    expect(state.detail.value?.status).toBe(OrderStatus.CANCELLED);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.getOne).toHaveBeenCalledTimes(1);
  });
});
