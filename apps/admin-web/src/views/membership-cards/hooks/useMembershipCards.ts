import {
  MembershipLevelStatus,
  type AdminMembershipLevelListItem,
  type AdminMembershipLevelListQuery,
} from '@bake-mall/contracts';
import { reactive, ref } from 'vue';

import { membershipCardsApi } from '../api/index.js';
import { DEFAULT_MEMBERSHIP_CARD_FILTERS } from '../config/defaults.js';
import type { MembershipCardFilters } from '../type/index.js';

export function canDeleteMembershipLevel(
  level: AdminMembershipLevelListItem,
): boolean {
  return (
    level.status === MembershipLevelStatus.INACTIVE && level.purchaseCount === 0
  );
}

function toQuery(
  filters: MembershipCardFilters,
): AdminMembershipLevelListQuery {
  const q = filters.q.trim();
  return {
    ...(q ? { q } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
}

export function useMembershipCards() {
  const levels = ref<readonly AdminMembershipLevelListItem[]>([]);
  const loading = ref(false);
  const actionId = ref<string | null>(null);
  const loadError = ref<unknown | null>(null);
  const actionError = ref<unknown | null>(null);
  const filters = reactive<MembershipCardFilters>({
    ...DEFAULT_MEMBERSHIP_CARD_FILTERS,
  });
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
      const rows = await membershipCardsApi.list(toQuery(filters));
      if (sequence === refreshSequence.value) levels.value = [...rows];
    } catch (error) {
      if (sequence === refreshSequence.value) loadError.value = error;
    } finally {
      if (sequence === refreshSequence.value) loading.value = false;
    }
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
    setFilters,
    refresh,
    toggleStatus,
    remove,
  };
}
