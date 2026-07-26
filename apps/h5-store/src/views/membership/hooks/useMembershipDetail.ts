import { computed, readonly, ref } from 'vue';
import type {
  MembershipOverviewView,
  PublicMembershipLevelView,
} from '@bake-mall/contracts';

import { captureSession, isCurrentSession } from '../../../stores/session.js';
import { membershipFeatureApi } from '../api/index.js';
import { getMembershipPurchaseCapability } from './purchase-capability.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '会员卡加载失败';
}

export function useMembershipDetail() {
  const level = ref<PublicMembershipLevelView | null>(null);
  const overview = ref<MembershipOverviewView | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const capability = computed(() =>
    level.value && overview.value
      ? getMembershipPurchaseCapability(overview.value, level.value)
      : null,
  );

  async function load(id: string): Promise<void> {
    const session = captureSession();
    level.value = null;
    loading.value = true;
    error.value = null;
    try {
      const [nextLevel, nextOverview] = await Promise.all([
        membershipFeatureApi.getLevel(id),
        membershipFeatureApi.getOverview(),
      ]);
      if (isCurrentSession(session)) {
        level.value = nextLevel;
        overview.value = nextOverview;
      }
    } catch (reason) {
      if (isCurrentSession(session)) error.value = errorMessage(reason);
      throw reason;
    } finally {
      if (isCurrentSession(session)) loading.value = false;
    }
  }

  return {
    data: { level: readonly(level), overview: readonly(overview) },
    capability,
    loading: computed(() => loading.value),
    error: readonly(error),
    methods: { load },
  };
}
