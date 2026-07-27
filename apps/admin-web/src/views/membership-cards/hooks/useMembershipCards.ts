import {
  MembershipLevelStatus,
  type AdminMembershipLevelListItem,
  type AdminMembershipLevelListQuery,
} from '@bake-mall/contracts';
import { reactive, ref } from 'vue';

import { DEFAULT_PAGE_SIZE } from '../../../config/pagination.js';
import {
  discountTextToBasisPoints,
  yuanTextToCents,
} from '../../../utils/money.js';
import { membershipCardsApi } from '../api/index.js';
import { createMembershipCardFilterDefaults } from '../config/defaults.js';
import type { MembershipCardFilters } from '../type/index.js';

export function canDeleteMembershipLevel(
  level: AdminMembershipLevelListItem,
): boolean {
  return (
    level.status === MembershipLevelStatus.INACTIVE && level.purchaseCount === 0
  );
}

function cloneFilters(filters: MembershipCardFilters): MembershipCardFilters {
  return {
    ...filters,
    updatedAtRange: filters.updatedAtRange
      ? [
          new Date(filters.updatedAtRange[0]),
          new Date(filters.updatedAtRange[1]),
        ]
      : null,
  };
}

function optionalMoney(value: string): number | undefined {
  return value.trim() ? yuanTextToCents(value) : undefined;
}

function optionalDiscount(value: string): number | undefined {
  return value.trim() ? discountTextToBasisPoints(value) : undefined;
}

export function toMembershipCardQuery(
  filters: MembershipCardFilters,
  page: number,
  pageSize: number,
): AdminMembershipLevelListQuery {
  const q = filters.q.trim();
  const minPriceCents = optionalMoney(filters.minPriceYuan);
  const maxPriceCents = optionalMoney(filters.maxPriceYuan);
  const minDiscountBasisPoints = optionalDiscount(filters.minDiscountText);
  const maxDiscountBasisPoints = optionalDiscount(filters.maxDiscountText);
  return {
    ...(q ? { q } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.rank !== null ? { rank: filters.rank } : {}),
    ...(minPriceCents !== undefined ? { minPriceCents } : {}),
    ...(maxPriceCents !== undefined ? { maxPriceCents } : {}),
    ...(minDiscountBasisPoints !== undefined ? { minDiscountBasisPoints } : {}),
    ...(maxDiscountBasisPoints !== undefined ? { maxDiscountBasisPoints } : {}),
    ...(filters.hasPurchases ? { hasPurchases: filters.hasPurchases } : {}),
    ...(filters.theme ? { theme: filters.theme } : {}),
    ...(filters.minValidDays !== null
      ? { minValidDays: filters.minValidDays }
      : {}),
    ...(filters.maxValidDays !== null
      ? { maxValidDays: filters.maxValidDays }
      : {}),
    ...(filters.updatedAtRange
      ? {
          updatedAtFrom: filters.updatedAtRange[0].toISOString(),
          updatedAtBefore: filters.updatedAtRange[1].toISOString(),
        }
      : {}),
    page,
    pageSize,
  };
}

export function useMembershipCards() {
  const levels = ref<readonly AdminMembershipLevelListItem[]>([]);
  const loading = ref(false);
  const actionId = ref<string | null>(null);
  const loadError = ref<unknown | null>(null);
  const actionError = ref<unknown | null>(null);
  const filters = reactive<MembershipCardFilters>(
    createMembershipCardFilterDefaults(),
  );
  const appliedFilters = ref<MembershipCardFilters>(
    createMembershipCardFilterDefaults(),
  );
  const page = ref(1);
  const pageSize = ref(DEFAULT_PAGE_SIZE);
  const total = ref(0);
  const refreshSequence = ref(0);

  function setFilters(next: Partial<MembershipCardFilters>): void {
    Object.assign(filters, next);
  }

  function applyLevel(saved: AdminMembershipLevelListItem): void {
    levels.value = levels.value.map((level) =>
      level.id === saved.id ? saved : level,
    );
  }

  async function refresh(): Promise<void> {
    const sequence = refreshSequence.value + 1;
    refreshSequence.value = sequence;
    loading.value = true;
    loadError.value = null;
    try {
      const result = await membershipCardsApi.list(
        toMembershipCardQuery(appliedFilters.value, page.value, pageSize.value),
      );
      if (sequence !== refreshSequence.value) return;
      levels.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
    } catch (error) {
      if (sequence === refreshSequence.value) loadError.value = error;
    } finally {
      if (sequence === refreshSequence.value) loading.value = false;
    }
  }

  async function search(): Promise<void> {
    try {
      const nextAppliedFilters = cloneFilters(filters);
      toMembershipCardQuery(nextAppliedFilters, 1, pageSize.value);
      appliedFilters.value = nextAppliedFilters;
      page.value = 1;
      await refresh();
    } catch (error) {
      refreshSequence.value += 1;
      loading.value = false;
      loadError.value = error;
    }
  }

  async function reset(): Promise<void> {
    const defaults = createMembershipCardFilterDefaults();
    Object.assign(filters, defaults);
    appliedFilters.value = defaults;
    page.value = 1;
    await refresh();
  }

  async function setPage(value: number): Promise<void> {
    page.value = value;
    await refresh();
  }

  async function setPageSize(value: number): Promise<void> {
    pageSize.value = value;
    page.value = 1;
    await refresh();
  }

  async function toggleStatus(
    level: AdminMembershipLevelListItem,
  ): Promise<void> {
    actionId.value = level.id;
    actionError.value = null;
    const nextStatus =
      level.status === MembershipLevelStatus.ACTIVE
        ? MembershipLevelStatus.INACTIVE
        : MembershipLevelStatus.ACTIVE;
    try {
      applyLevel(
        await membershipCardsApi.updateStatus(
          level.id,
          nextStatus,
          level.version,
        ),
      );
    } catch (error) {
      actionError.value = error;
      throw error;
    } finally {
      actionId.value = null;
    }
  }

  async function remove(level: AdminMembershipLevelListItem): Promise<void> {
    if (!canDeleteMembershipLevel(level)) {
      throw new Error('只有未售下架草稿可以删除');
    }
    actionId.value = level.id;
    actionError.value = null;
    try {
      await membershipCardsApi.remove(level.id);
      levels.value = levels.value.filter(({ id }) => id !== level.id);
      total.value = Math.max(0, total.value - 1);
    } catch (error) {
      actionError.value = error;
      throw error;
    } finally {
      actionId.value = null;
    }
  }

  return {
    levels,
    loading,
    actionId,
    loadError,
    actionError,
    filters,
    page,
    pageSize,
    total,
    setFilters,
    refresh,
    search,
    reset,
    setPage,
    setPageSize,
    toggleStatus,
    remove,
  };
}
