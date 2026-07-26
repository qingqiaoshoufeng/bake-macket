import { computed, readonly, ref } from 'vue';
import type { MembershipOverviewView } from '@bake-mall/contracts';

import { captureSession, isCurrentSession } from '../../../stores/session.js';
import { membershipFeatureApi } from '../api/index.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '会员资产加载失败';
}

export function useMembershipOverview() {
  const overview = ref<MembershipOverviewView | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<MembershipOverviewView> {
    const session = captureSession();
    loading.value = true;
    error.value = null;
    try {
      const next = await membershipFeatureApi.getOverview();
      if (isCurrentSession(session)) overview.value = next;
      return next;
    } catch (reason) {
      if (isCurrentSession(session)) error.value = errorMessage(reason);
      throw reason;
    } finally {
      if (isCurrentSession(session)) loading.value = false;
    }
  }

  return {
    data: { overview: readonly(overview) },
    loading: computed(() => loading.value),
    error: readonly(error),
    methods: { load },
  };
}
