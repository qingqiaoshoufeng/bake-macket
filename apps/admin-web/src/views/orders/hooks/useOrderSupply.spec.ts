import {
  AdminOrderSupplyMatchType,
  FulfillmentType,
  OrderStatus,
  type AdminOrderSupplyDetailResult,
  type AdminOrderSupplyResult,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ordersApi } from '../api/index.js';
import { createOrderFilterDefaults } from '../config/defaults.js';
import { useOrderSupply } from './useOrderSupply.js';

vi.mock('../api/index.js', () => ({
  ordersApi: {
    listSupply: vi.fn(),
    listSupplyItems: vi.fn(),
  },
}));

const api = vi.mocked(ordersApi);
const filters = createOrderFilterDefaults();
const listResult: AdminOrderSupplyResult = {
  items: [
    {
      groupKey: 'sku:1',
      matchType: AdminOrderSupplyMatchType.SKU_ID,
      productId: 'product-1',
      skuId: '1',
      productName: '草莓蛋糕',
      skuName: '6寸',
      skuAttributes: { size: '6寸' },
      requiredQuantity: 3,
      orderCount: 2,
      newQuantity: 1,
      processingQuantity: 2,
      remainingSaleableStock: 10,
      earliestOrderCreatedAt: '2026-07-28T01:00:00.000Z',
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
};
const detailResult: AdminOrderSupplyDetailResult = {
  items: [
    {
      orderItemId: 'item-1',
      orderId: 'order-1',
      orderNo: 'BM1',
      status: OrderStatus.NEW,
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '张三',
      contactPhone: '13800000000',
      productId: 'product-1',
      skuId: '1',
      productName: '草莓蛋糕',
      skuName: '6寸',
      skuAttributes: { size: '6寸' },
      quantity: 1,
      unitPriceCents: 6800,
      lineGoodsTotalCents: 6800,
      lineMembershipDiscountCents: 0,
      linePayableCents: 6800,
      orderCreatedAt: '2026-07-28T01:00:00.000Z',
    },
  ],
  page: 1,
  pageSize: 50,
  total: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('useOrderSupply', () => {
  afterEach(() => vi.resetAllMocks());

  it('keeps status drafts separate until search applies them', async () => {
    api.listSupply.mockResolvedValue(listResult);
    const state = useOrderSupply();
    state.setSupplyStatuses([OrderStatus.PROCESSING]);

    await state.load(filters);
    expect(api.listSupply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
      }),
    );

    state.applyStatusDraft();
    await state.load(filters);
    expect(api.listSupply).toHaveBeenLastCalledWith(
      expect.objectContaining({ supplyStatuses: [OrderStatus.PROCESSING] }),
    );
  });

  it('keeps only the latest list response', async () => {
    const older = deferred<AdminOrderSupplyResult>();
    api.listSupply
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce({ ...listResult, items: [], page: 2, total: 0 });
    const state = useOrderSupply();

    const oldLoad = state.load(filters);
    state.page.value = 2;
    await state.load(filters);
    older.resolve(listResult);
    await oldLoad;

    expect(state.items.value).toEqual([]);
    expect(state.page.value).toBe(2);
  });

  it('loads each expanded group lazily, caches it, and clears cache after applying filters', async () => {
    api.listSupplyItems.mockResolvedValue(detailResult);
    const state = useOrderSupply();

    await state.loadDetail('sku:1', filters);
    await state.loadDetail('sku:1', filters);

    expect(api.listSupplyItems).toHaveBeenCalledOnce();
    expect(state.details.value.get('sku:1')?.items).toHaveLength(1);

    state.applyStatusDraft();
    expect(state.details.value.size).toBe(0);
  });

  it('does not let a stale detail response repopulate cleared filter results', async () => {
    const older = deferred<AdminOrderSupplyDetailResult>();
    const newer = deferred<AdminOrderSupplyDetailResult>();
    api.listSupplyItems
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const state = useOrderSupply();

    const oldLoad = state.loadDetail('sku:1', filters);
    state.clearDetails();
    const newLoad = state.loadDetail('sku:1', filters);
    newer.resolve({
      ...detailResult,
      items: [{ ...detailResult.items[0], orderNo: 'BM-NEW' }],
    });
    await newLoad;
    older.resolve(detailResult);
    await oldLoad;

    expect(state.details.value.get('sku:1')?.items[0]?.orderNo).toBe('BM-NEW');
  });

  it('keeps a detail failure local and retries the same page', async () => {
    api.listSupplyItems
      .mockRejectedValueOnce(new Error('明细失败'))
      .mockResolvedValueOnce(detailResult);
    const state = useOrderSupply();

    await state.loadDetail('sku:1', filters, 1);
    expect(state.details.value.get('sku:1')?.error).toBe('明细失败');

    await state.retryDetail('sku:1', filters);
    expect(state.details.value.get('sku:1')?.error).toBeNull();
    expect(api.listSupplyItems).toHaveBeenCalledTimes(2);
  });
});
