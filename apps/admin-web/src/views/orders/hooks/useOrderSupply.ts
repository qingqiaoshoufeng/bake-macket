import {
  OrderStatus,
  type AdminOrderSupplyDetailItem,
  type AdminOrderSupplyItem,
  type SupplyOrderStatus,
} from '@bake-mall/contracts';
import { ref } from 'vue';

import { DEFAULT_PAGE_SIZE } from '../../../config/pagination.js';
import { ordersApi } from '../api/index.js';
import type { OrderFilterForm } from '../type/index.js';
import { toOrderFilterQuery, toSupplyQuery } from './order-query.js';

const DETAIL_PAGE_SIZE = 50;

export const DEFAULT_SUPPLY_STATUSES: readonly SupplyOrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.PROCESSING,
];

export type SupplyDetailState = {
  readonly items: readonly AdminOrderSupplyDetailItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly error: string | null;
};

const emptyDetailState = (): SupplyDetailState => ({
  items: [],
  page: 1,
  pageSize: DETAIL_PAGE_SIZE,
  total: 0,
  loading: false,
  loaded: false,
  error: null,
});

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export function useOrderSupply() {
  const items = ref<readonly AdminOrderSupplyItem[]>([]);
  const supplyStatuses = ref<readonly SupplyOrderStatus[]>([
    ...DEFAULT_SUPPLY_STATUSES,
  ]);
  const appliedSupplyStatuses = ref<readonly SupplyOrderStatus[]>([
    ...DEFAULT_SUPPLY_STATUSES,
  ]);
  const page = ref(1);
  const pageSize = ref(DEFAULT_PAGE_SIZE);
  const total = ref(0);
  const loading = ref(false);
  const lastError = ref<string | null>(null);
  const details = ref<ReadonlyMap<string, SupplyDetailState>>(new Map());
  let listSequence = 0;
  let detailEpoch = 0;
  const detailSequences = new Map<string, number>();

  function setSupplyStatuses(statuses: readonly SupplyOrderStatus[]): void {
    if (statuses.length === 0) return;
    supplyStatuses.value = [...statuses];
  }

  function applyStatusDraft(): void {
    appliedSupplyStatuses.value = [...supplyStatuses.value];
    page.value = 1;
    clearDetails();
  }

  function resetState(): void {
    supplyStatuses.value = [...DEFAULT_SUPPLY_STATUSES];
    appliedSupplyStatuses.value = [...DEFAULT_SUPPLY_STATUSES];
    page.value = 1;
    clearDetails();
  }

  function clearDetails(): void {
    detailEpoch += 1;
    details.value = new Map();
    detailSequences.clear();
  }

  async function load(filters: OrderFilterForm): Promise<void> {
    const sequence = listSequence + 1;
    listSequence = sequence;
    loading.value = true;
    lastError.value = null;
    try {
      const result = await ordersApi.listSupply(
        toSupplyQuery(
          filters,
          appliedSupplyStatuses.value,
          page.value,
          pageSize.value,
        ),
      );
      if (sequence !== listSequence) return;
      items.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
    } catch (error) {
      if (sequence === listSequence) {
        lastError.value = errorMessage(error, '供货清单加载失败，请重试');
      }
    } finally {
      if (sequence === listSequence) loading.value = false;
    }
  }

  async function setPage(
    value: number,
    filters: OrderFilterForm,
  ): Promise<void> {
    page.value = value;
    await load(filters);
  }

  async function setPageSize(
    value: number,
    filters: OrderFilterForm,
  ): Promise<void> {
    pageSize.value = value;
    page.value = 1;
    await load(filters);
  }

  function updateDetail(groupKey: string, state: SupplyDetailState): void {
    details.value = new Map([...details.value, [groupKey, state]]);
  }

  async function loadDetail(
    groupKey: string,
    filters: OrderFilterForm,
    requestedPage = 1,
    force = false,
  ): Promise<void> {
    const current = details.value.get(groupKey) ?? emptyDetailState();
    if (
      !force &&
      (current.loading || (current.loaded && current.page === requestedPage))
    ) {
      return;
    }

    const epoch = detailEpoch;
    const sequence = (detailSequences.get(groupKey) ?? 0) + 1;
    detailSequences.set(groupKey, sequence);
    updateDetail(groupKey, {
      ...current,
      page: requestedPage,
      loading: true,
      error: null,
    });
    try {
      const result = await ordersApi.listSupplyItems({
        ...toOrderFilterQuery(filters),
        groupKey,
        supplyStatuses: [...appliedSupplyStatuses.value],
        page: requestedPage,
        pageSize: current.pageSize,
      });
      if (detailEpoch !== epoch || detailSequences.get(groupKey) !== sequence)
        return;
      updateDetail(groupKey, {
        items: [...result.items],
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        loading: false,
        loaded: true,
        error: null,
      });
    } catch (error) {
      if (detailEpoch !== epoch || detailSequences.get(groupKey) !== sequence)
        return;
      updateDetail(groupKey, {
        ...current,
        page: requestedPage,
        loading: false,
        loaded: false,
        error: errorMessage(error, '供货明细加载失败，请重试'),
      });
    }
  }

  async function retryDetail(
    groupKey: string,
    filters: OrderFilterForm,
  ): Promise<void> {
    const requestedPage = details.value.get(groupKey)?.page ?? 1;
    await loadDetail(groupKey, filters, requestedPage, true);
  }

  return {
    items,
    supplyStatuses,
    appliedSupplyStatuses,
    page,
    pageSize,
    total,
    loading,
    lastError,
    details,
    setSupplyStatuses,
    applyStatusDraft,
    resetState,
    clearDetails,
    load,
    setPage,
    setPageSize,
    loadDetail,
    retryDetail,
  };
}
