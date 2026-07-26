import {
  type AdminMembershipPurchaseDetailView,
  type AdminMembershipPurchaseListQuery,
  type MembershipPurchaseView,
} from '@bake-mall/contracts';
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
  type ComputedRef,
} from 'vue';

import { membershipPurchasesApi } from '../api/index.js';
import { createMembershipPurchaseFilterDefaults } from '../config/defaults.js';
import { MEMBERSHIP_PURCHASE_PAGINATION } from '../config/pagination.js';
import type { MembershipPurchaseFilterForm } from '../type/index.js';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function toMembershipPurchaseQuery(
  filters: MembershipPurchaseFilterForm,
  page: number,
  pageSize: number,
): AdminMembershipPurchaseListQuery {
  const purchaseNo = filters.purchaseNo.trim();
  const userId = filters.userId.trim();
  const levelId = filters.levelId.trim();
  const status = filters.status || undefined;
  return {
    ...(purchaseNo ? { purchaseNo } : {}),
    ...(userId ? { userId } : {}),
    ...(levelId ? { levelId } : {}),
    ...(status ? { status } : {}),
    ...(filters.createdAtRange
      ? {
          createdAtFrom: filters.createdAtRange[0].toISOString(),
          createdAtBefore: filters.createdAtRange[1].toISOString(),
        }
      : {}),
    page,
    pageSize,
  };
}

type VoidSelectedResult =
  | { status: 'applied'; detail: AdminMembershipPurchaseDetailView }
  | { status: 'stale' };

function rowFromDetail(
  detail: AdminMembershipPurchaseDetailView,
): MembershipPurchaseView {
  const {
    benefits: _benefits,
    paymentChannel: _paymentChannel,
    membershipId,
    paidAt,
    voidedAt,
    ...purchase
  } = detail.purchase;
  return {
    ...purchase,
    voidability: detail.voidability,
    ...(membershipId ? { membershipId } : {}),
    ...(paidAt ? { paidAt } : {}),
    ...(voidedAt ? { voidedAt } : {}),
  };
}

export function useMembershipPurchases() {
  const purchases = ref<readonly MembershipPurchaseView[]>([]);
  const detail = ref<AdminMembershipPurchaseDetailView | null>(null);
  const filters = reactive<MembershipPurchaseFilterForm>(
    createMembershipPurchaseFilterDefaults(),
  );
  const page = ref<number>(MEMBERSHIP_PURCHASE_PAGINATION.defaultPage);
  const pageSize = ref<number>(MEMBERSHIP_PURCHASE_PAGINATION.defaultPageSize);
  const total = ref(0);
  const loading = ref(false);
  const detailLoading = ref(false);
  const voiding = ref(false);
  const listError = ref<string | null>(null);
  const detailError = ref<string | null>(null);
  const actionError = ref<string | null>(null);
  const detailVisible = ref(false);
  const selectedPurchaseId = ref<string | null>(null);
  const sequence = { list: 0, detail: 0, action: 0 };
  const alive = ref(true);

  const selectedMembershipId: ComputedRef<string | null> = computed(
    () => detail.value?.segment?.membershipId ?? null,
  );

  function setFilters(value: Partial<MembershipPurchaseFilterForm>): void {
    Object.assign(filters, value);
  }

  function isCurrent(kind: keyof typeof sequence, value: number): boolean {
    return alive.value && sequence[kind] === value;
  }

  async function load(): Promise<void> {
    const request = sequence.list + 1;
    sequence.list = request;
    loading.value = true;
    listError.value = null;
    try {
      const result = await membershipPurchasesApi.list(
        toMembershipPurchaseQuery(filters, page.value, pageSize.value),
      );
      if (!isCurrent('list', request)) return;
      purchases.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
    } catch (error) {
      if (isCurrent('list', request)) {
        listError.value = messageOf(error, '购卡记录加载失败，请重试');
      }
    } finally {
      if (isCurrent('list', request)) loading.value = false;
    }
  }

  async function search(): Promise<void> {
    page.value = 1;
    await load();
  }

  async function reset(): Promise<void> {
    Object.assign(filters, createMembershipPurchaseFilterDefaults());
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
    sequence.action += 1;
    voiding.value = false;
    const request = sequence.detail + 1;
    sequence.detail = request;
    selectedPurchaseId.value = id;
    detail.value = null;
    detailError.value = null;
    actionError.value = null;
    detailVisible.value = true;
    detailLoading.value = true;
    try {
      const result = await membershipPurchasesApi.getOne(id);
      if (isCurrent('detail', request) && selectedPurchaseId.value === id) {
        detail.value = result;
      }
    } catch (error) {
      if (isCurrent('detail', request) && selectedPurchaseId.value === id) {
        detailError.value = messageOf(error, '购卡详情加载失败，请重试');
      }
    } finally {
      if (isCurrent('detail', request)) detailLoading.value = false;
    }
  }

  function closeDetail(): void {
    if (voiding.value) return;
    sequence.detail += 1;
    detailVisible.value = false;
    selectedPurchaseId.value = null;
    detail.value = null;
    detailError.value = null;
    detailLoading.value = false;
  }

  async function retryDetail(): Promise<void> {
    const id = selectedPurchaseId.value;
    if (id) await openDetail(id);
  }

  function updateReturnedListRow(
    result: AdminMembershipPurchaseDetailView,
  ): void {
    const updatedRow = rowFromDetail(result);
    purchases.value = purchases.value.map((purchase) =>
      purchase.id === updatedRow.id ? updatedRow : purchase,
    );
  }

  async function voidSelected(): Promise<VoidSelectedResult> {
    const selected = detail.value;
    const id = selected?.purchase.id;
    if (!selected || !id) throw new Error('请先选择购卡记录');
    if (!selected.voidability.allowed) {
      throw new Error(selected.voidability.reason);
    }
    const request = sequence.action + 1;
    sequence.action = request;
    voiding.value = true;
    actionError.value = null;
    try {
      const result = await membershipPurchasesApi.voidPurchase(id);
      updateReturnedListRow(result);
      if (
        !isCurrent('action', request) ||
        !detailVisible.value ||
        selectedPurchaseId.value !== id
      ) {
        return { status: 'stale' };
      }
      detail.value = result;
      return { status: 'applied', detail: result };
    } catch (error) {
      if (
        !isCurrent('action', request) ||
        !detailVisible.value ||
        selectedPurchaseId.value !== id
      ) {
        return { status: 'stale' };
      }
      const message = messageOf(error, '购卡记录作废失败，请重试');
      actionError.value = message;
      throw error instanceof Error ? error : new Error(message);
    } finally {
      if (
        isCurrent('action', request) &&
        detailVisible.value &&
        selectedPurchaseId.value === id
      ) {
        voiding.value = false;
      }
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      alive.value = false;
      sequence.list += 1;
      sequence.detail += 1;
      sequence.action += 1;
      detailVisible.value = false;
      selectedPurchaseId.value = null;
    });
  }

  return {
    purchases,
    detail,
    filters,
    page,
    pageSize,
    total,
    loading,
    detailLoading,
    voiding,
    listError,
    detailError,
    actionError,
    detailVisible,
    selectedPurchaseId,
    selectedMembershipId,
    setFilters,
    load,
    search,
    reset,
    setPage,
    setPageSize,
    openDetail,
    closeDetail,
    retryDetail,
    voidSelected,
  };
}
