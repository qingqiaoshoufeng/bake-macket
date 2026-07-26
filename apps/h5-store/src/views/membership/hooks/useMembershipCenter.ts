import { computed, readonly, ref } from 'vue';
import type {
  MemberCreditEntryView,
  MembershipOverviewView,
  MembershipPurchaseView,
} from '@bake-mall/contracts';

import { captureSession, isCurrentSession } from '../../../stores/session.js';
import { membershipFeatureApi } from '../api/index.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '会员中心加载失败';
}

export function useMembershipCenter() {
  const overview = ref<MembershipOverviewView | null>(null);
  const purchases = ref<MembershipPurchaseView[]>([]);
  const creditEntries = ref<MemberCreditEntryView[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    const session = captureSession();
    loading.value = true;
    error.value = null;
    try {
      const [nextOverview, nextPurchases, nextCreditEntries] =
        await Promise.all([
          membershipFeatureApi.getOverview(),
          membershipFeatureApi.listPurchases(),
          membershipFeatureApi.listCreditEntries(),
        ]);
      if (isCurrentSession(session)) {
        overview.value = nextOverview;
        purchases.value = [...nextPurchases];
        creditEntries.value = [...nextCreditEntries];
      }
    } catch (reason) {
      if (isCurrentSession(session)) error.value = errorMessage(reason);
      throw reason;
    } finally {
      if (isCurrentSession(session)) loading.value = false;
    }
  }

  return {
    data: {
      overview: readonly(overview),
      purchases: readonly(purchases),
      creditEntries: readonly(creditEntries),
    },
    loading: computed(() => loading.value),
    error: readonly(error),
    methods: { load },
  };
}
