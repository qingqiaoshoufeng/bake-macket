import {
  OrderStatus,
  canTransitionOrder,
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
import type { OrderAction } from './useOrderActions.js';

const ACTIONS: readonly OrderAction[] = [
  {
    key: 'start',
    status: OrderStatus.PROCESSING,
    label: '开始处理',
    description: '开始安排生产或配送。',
  },
  {
    key: 'complete',
    status: OrderStatus.COMPLETED,
    label: '完成订单',
    description: '确认订单已经交付。',
  },
  {
    key: 'cancel',
    status: OrderStatus.CANCELLED,
    label: '取消订单',
    description: '取消订单不会回补库存。',
  },
];

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
  const detailVisible = ref(false);

  const actions = computed<readonly OrderAction[]>(() => {
    const status = detail.value?.status;
    return status
      ? ACTIONS.filter((action) => canTransitionOrder(status, action.status))
      : [];
  });

  async function load(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      const result = await ordersApi.list(
        toQuery(filters, page.value, pageSize.value),
      );
      orders.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
    } catch {
      lastError.value = '订单加载失败，请重试';
    } finally {
      loading.value = false;
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
    detailVisible.value = true;
    detailLoading.value = true;
    try {
      detail.value = await ordersApi.getOne(id);
    } finally {
      detailLoading.value = false;
    }
  }

  function closeDetail(): void {
    if (!updating.value) detailVisible.value = false;
  }

  async function updateStatus(
    status: OrderStatus,
  ): Promise<OrderStatusUpdateResult> {
    if (!detail.value) throw new Error('请先选择订单');
    updating.value = true;
    try {
      const result = await ordersApi.updateStatus(detail.value.id, status);
      detail.value = result.order;
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
