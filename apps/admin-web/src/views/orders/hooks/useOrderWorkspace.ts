import {
  AdminOrderExportView,
  type SupplyOrderStatus,
} from '@bake-mall/contracts';
import { computed, ref } from 'vue';

import { useOrderExport } from './useOrderExport.js';
import { useOrders } from './useOrders.js';
import { useOrderSupply } from './useOrderSupply.js';

export function useOrderWorkspace() {
  const mode = ref(AdminOrderExportView.ORDER);
  const orderList = useOrders();
  const supplyList = useOrderSupply();
  const exportState = useOrderExport();

  const activeLoading = computed(() =>
    mode.value === AdminOrderExportView.ORDER
      ? orderList.loading.value
      : supplyList.loading.value,
  );
  const activeError = computed(() =>
    mode.value === AdminOrderExportView.ORDER
      ? orderList.lastError.value
      : supplyList.lastError.value,
  );
  const activePage = computed(() =>
    mode.value === AdminOrderExportView.ORDER
      ? orderList.page.value
      : supplyList.page.value,
  );
  const activePageSize = computed(() =>
    mode.value === AdminOrderExportView.ORDER
      ? orderList.pageSize.value
      : supplyList.pageSize.value,
  );
  const activeTotal = computed(() =>
    mode.value === AdminOrderExportView.ORDER
      ? orderList.total.value
      : supplyList.total.value,
  );

  async function initialize(): Promise<void> {
    await orderList.load();
  }

  async function switchMode(nextMode: AdminOrderExportView): Promise<void> {
    if (mode.value === nextMode) return;
    mode.value = nextMode;
    if (nextMode === AdminOrderExportView.ORDER) {
      await orderList.load();
      return;
    }
    await supplyList.load(orderList.appliedFilters.value);
  }

  async function search(): Promise<void> {
    if (mode.value === AdminOrderExportView.ORDER) {
      orderList.applyFilterDraft();
      await orderList.load();
      return;
    }
    orderList.applySharedFilterDraft();
    supplyList.applyStatusDraft();
    await supplyList.load(orderList.appliedFilters.value);
  }

  async function reset(): Promise<void> {
    if (mode.value === AdminOrderExportView.ORDER) {
      orderList.resetFilterState();
      await orderList.load();
      return;
    }
    orderList.resetSharedFilterState();
    supplyList.resetState();
    await supplyList.load(orderList.appliedFilters.value);
  }

  async function setPage(value: number): Promise<void> {
    if (mode.value === AdminOrderExportView.ORDER) {
      await orderList.setPage(value);
      return;
    }
    await supplyList.setPage(value, orderList.appliedFilters.value);
  }

  async function setPageSize(value: number): Promise<void> {
    if (mode.value === AdminOrderExportView.ORDER) {
      await orderList.setPageSize(value);
      return;
    }
    await supplyList.setPageSize(value, orderList.appliedFilters.value);
  }

  function setSupplyStatuses(statuses: readonly SupplyOrderStatus[]): void {
    supplyList.setSupplyStatuses(statuses);
  }

  async function exportCurrent(): Promise<void> {
    await exportState.exportOrders(
      mode.value,
      orderList.appliedFilters.value,
      supplyList.appliedSupplyStatuses.value,
    );
  }

  return {
    mode,
    orderList,
    supplyList,
    exportState,
    activeLoading,
    activeError,
    activePage,
    activePageSize,
    activeTotal,
    filters: orderList.filters,
    appliedFilters: orderList.appliedFilters,
    advancedCount: orderList.advancedCount,
    initialize,
    switchMode,
    search,
    reset,
    setPage,
    setPageSize,
    setSupplyStatuses,
    exportCurrent,
  };
}
