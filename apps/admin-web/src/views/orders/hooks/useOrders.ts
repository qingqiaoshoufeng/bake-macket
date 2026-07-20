import {
  OrderStatus,
  type AdminOrderListItem,
  type AdminOrderListQuery,
  type OrderStatusUpdateResult,
  type OrderView,
} from '@bake-mall/contracts';
import { computed, reactive, ref } from 'vue';

import { ordersApi } from '../api/index.js';
import { createOrderFilterDefaults } from '../config/defaults.js';
import { ORDER_PAGINATION } from '../config/pagination.js';
import type { OrderFilterForm } from '../type/index.js';
import { deriveOrderActions, type OrderAction } from './useOrderActions.js';

const toQuery = (
  filters: OrderFilterForm,
  page: number,
  pageSize: number,
): AdminOrderListQuery => ({
  ...(filters.orderNo.trim() ? { orderNo: filters.orderNo.trim() } : {}),
  ...(filters.status ? { status: filters.status } : {}),
  ...(filters.fulfillmentType
    ? { fulfillmentType: filters.fulfillmentType }
    : {}),
  ...(filters.createdAtRange
    ? {
        createdAtFrom: filters.createdAtRange[0].toISOString(),
        createdAtBefore: filters.createdAtRange[1].toISOString(),
      }
    : {}),
  page,
  pageSize,
});

export function useOrders() {
  const orders = ref<readonly AdminOrderListItem[]>([]);
  const detail = ref<OrderView | null>(null);
  const filters = reactive<OrderFilterForm>(createOrderFilterDefaults());
  const page = ref<number>(ORDER_PAGINATION.defaultPage);
  const pageSize = ref<number>(ORDER_PAGINATION.defaultPageSize);
  const total = ref(0);
  const loading = ref(false);
  const detailLoading = ref(false);
  const updating = ref(false);
  const lastError = ref<string | null>(null);
  const detailError = ref<string | null>(null);
  const detailVisible = ref(false);
  let listSequence = 0;
  let detailSequence = 0;

  const actions = computed<readonly OrderAction[]>(() => {
    const status = detail.value?.status;
    return status ? deriveOrderActions(status) : [];
  });

  async function load(): Promise<void> {
    const sequence = listSequence + 1;
    listSequence = sequence;
    loading.value = true;
    lastError.value = null;
    try {
      const result = await ordersApi.list(
        toQuery(filters, page.value, pageSize.value),
      );
      if (sequence !== listSequence) return;
      orders.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
    } catch {
      if (sequence === listSequence) {
        lastError.value = '订单加载失败，请重试';
      }
    } finally {
      if (sequence === listSequence) loading.value = false;
    }
  }

  async function search(): Promise<void> {
    page.value = 1;
    await load();
  }

  async function reset(): Promise<void> {
    Object.assign(filters, createOrderFilterDefaults());
    page.value = 1;
    await load();
  }

  async function setPage(value: number): Promise<void> {
    page.value = value;
    await load();
  }

  async function setPageSize(value: number): Promise<void> {
    pageSize.value = value;
    page.value = 1;
    await load();
  }

  async function openDetail(id: string): Promise<void> {
    const sequence = detailSequence + 1;
    detailSequence = sequence;
    detailVisible.value = true;
    detail.value = null;
    detailError.value = null;
    detailLoading.value = true;
    try {
      const nextDetail = await ordersApi.getOne(id);
      if (sequence === detailSequence) detail.value = nextDetail;
    } catch {
      if (sequence === detailSequence) {
        detailError.value = '订单详情加载失败，请重试';
      }
    } finally {
      if (sequence === detailSequence) detailLoading.value = false;
    }
  }

  function closeDetail(): void {
    if (!updating.value) detailVisible.value = false;
  }

  async function updateStatus(
    status: OrderStatus,
  ): Promise<OrderStatusUpdateResult> {
    const selectedDetail = detail.value;
    if (!selectedDetail || detailLoading.value) throw new Error('请先选择订单');
    updating.value = true;
    try {
      const result = await ordersApi.updateStatus(selectedDetail.id, status);
      if (detail.value?.id === selectedDetail.id) detail.value = result.order;
      await load();
      return result;
    } finally {
      updating.value = false;
    }
  }

  return {
    orders,
    detail,
    filters,
    page,
    pageSize,
    total,
    loading,
    detailLoading,
    updating,
    lastError,
    detailError,
    detailVisible,
    actions,
    load,
    search,
    reset,
    setPage,
    setPageSize,
    openDetail,
    closeDetail,
    updateStatus,
  };
}
