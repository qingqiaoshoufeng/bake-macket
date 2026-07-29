import { AdminOrderExportView } from '@bake-mall/contracts';
import { ref } from 'vue';

import { saveBlob } from '../../../utils/download.js';
import { ordersApi } from '../api/index.js';
import type { OrderFilterForm } from '../type/index.js';
import { toOrderExportQuery, toSupplyExportQuery } from './order-query.js';
import type { SupplyOrderStatus } from '@bake-mall/contracts';

const DEFAULT_FILENAMES: Readonly<Record<AdminOrderExportView, string>> = {
  [AdminOrderExportView.ORDER]: '订单列表.xlsx',
  [AdminOrderExportView.SUPPLY]: 'SKU供货清单.xlsx',
};

export function useOrderExport() {
  const exporting = ref(false);
  const exportError = ref<string | null>(null);

  async function exportOrders(
    view: AdminOrderExportView,
    filters: OrderFilterForm,
    supplyStatuses: readonly SupplyOrderStatus[],
  ): Promise<void> {
    if (exporting.value) return;
    exporting.value = true;
    exportError.value = null;
    try {
      const query =
        view === AdminOrderExportView.ORDER
          ? toOrderExportQuery(filters)
          : toSupplyExportQuery(filters, supplyStatuses);
      const file = await ordersApi.export(query);
      saveBlob(file.blob, file.filename ?? DEFAULT_FILENAMES[view]);
    } catch (error) {
      exportError.value =
        error instanceof Error ? error.message : '订单导出失败，请重试';
      throw error;
    } finally {
      exporting.value = false;
    }
  }

  return { exporting, exportError, exportOrders };
}
