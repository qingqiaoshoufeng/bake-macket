import { AdminOrderExportView, OrderStatus } from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveBlob } from '../../../utils/download.js';
import { ordersApi } from '../api/index.js';
import { createOrderFilterDefaults } from '../config/defaults.js';
import { useOrderExport } from './useOrderExport.js';

vi.mock('../api/index.js', () => ({ ordersApi: { export: vi.fn() } }));
vi.mock('../../../utils/download.js', () => ({ saveBlob: vi.fn() }));

const api = vi.mocked(ordersApi);
const save = vi.mocked(saveBlob);

describe('useOrderExport', () => {
  afterEach(() => vi.resetAllMocks());

  it('exports applied supply filters and uses the safe fallback filename', async () => {
    api.export.mockResolvedValue({ blob: new Blob(['xlsx']) });
    const state = useOrderExport();
    const filters = { ...createOrderFilterDefaults(), contact: '已应用联系人' };

    await state.exportOrders(AdminOrderExportView.SUPPLY, filters, [
      OrderStatus.NEW,
    ]);

    expect(api.export).toHaveBeenCalledWith({
      view: AdminOrderExportView.SUPPLY,
      contact: '已应用联系人',
      supplyStatuses: [OrderStatus.NEW],
    });
    expect(save).toHaveBeenCalledWith(expect.any(Blob), 'SKU供货清单.xlsx');
  });

  it('prevents duplicate downloads while an export is running', async () => {
    let release!: (file: { blob: Blob; filename: string }) => void;
    api.export.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const state = useOrderExport();
    const filters = createOrderFilterDefaults();

    const first = state.exportOrders(AdminOrderExportView.ORDER, filters, []);
    await state.exportOrders(AdminOrderExportView.ORDER, filters, []);
    expect(api.export).toHaveBeenCalledOnce();

    release({ blob: new Blob(['xlsx']), filename: '订单列表.xlsx' });
    await first;
    expect(state.exporting.value).toBe(false);
  });
});
