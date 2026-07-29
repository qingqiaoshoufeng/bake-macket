import { AdminOrderExportView, OrderStatus } from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ordersApi } from '../api/index.js';
import { useOrderWorkspace } from './useOrderWorkspace.js';

vi.mock('../api/index.js', () => ({
  ordersApi: {
    list: vi.fn(),
    listSupply: vi.fn(),
    listSupplyItems: vi.fn(),
    export: vi.fn(),
    getOne: vi.fn(),
    updateStatus: vi.fn(),
  },
}));
vi.mock('../../../utils/download.js', () => ({ saveBlob: vi.fn() }));

const api = vi.mocked(ordersApi);
const empty = { items: [], page: 1, pageSize: 20, total: 0 };

describe('useOrderWorkspace', () => {
  afterEach(() => vi.resetAllMocks());

  it('keeps independent pages and switching mode never exports', async () => {
    api.list.mockImplementation(async ({ page, pageSize }) => ({
      ...empty,
      page,
      pageSize,
    }));
    api.listSupply.mockImplementation(async ({ page, pageSize }) => ({
      ...empty,
      page,
      pageSize,
    }));
    const state = useOrderWorkspace();
    state.orderList.page.value = 3;
    state.supplyList.page.value = 2;

    await state.switchMode(AdminOrderExportView.SUPPLY);
    expect(state.activePage.value).toBe(2);
    await state.switchMode(AdminOrderExportView.ORDER);
    expect(state.activePage.value).toBe(3);
    expect(api.export).not.toHaveBeenCalled();
  });

  it('applies filter and supply-status drafts together on search', async () => {
    api.listSupply.mockResolvedValue({ ...empty });
    const state = useOrderWorkspace();
    await state.switchMode(AdminOrderExportView.SUPPLY);
    state.orderList.setFilters({ contact: '已应用联系人' });
    state.setSupplyStatuses([OrderStatus.PROCESSING]);

    await state.search();

    expect(api.listSupply).toHaveBeenLastCalledWith({
      contact: '已应用联系人',
      supplyStatuses: [OrderStatus.PROCESSING],
      page: 1,
      pageSize: 20,
    });
  });

  it('does not apply the hidden order-status draft from supply-mode searches', async () => {
    api.list.mockResolvedValue({ ...empty });
    api.listSupply.mockResolvedValue({ ...empty });
    const state = useOrderWorkspace();
    state.orderList.setFilters({ status: OrderStatus.NEW });
    await state.search();
    state.orderList.setFilters({ status: OrderStatus.PROCESSING });
    await state.switchMode(AdminOrderExportView.SUPPLY);

    await state.search();
    await state.switchMode(AdminOrderExportView.ORDER);

    expect(api.list).toHaveBeenLastCalledWith({
      status: OrderStatus.NEW,
      page: 1,
      pageSize: 20,
    });
  });
});
