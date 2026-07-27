import { getCurrentScope, onScopeDispose, ref } from 'vue';

import { membershipCardsApi } from '../../membership-cards/api/index.js';
import type { MembershipLevelOption } from '../type/index.js';

export function useMembershipLevelOptions() {
  const options = ref<readonly MembershipLevelOption[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const sequence = ref(0);
  const alive = ref(true);

  async function load(): Promise<void> {
    const request = sequence.value + 1;
    sequence.value = request;
    loading.value = true;
    error.value = null;
    try {
      const result = await membershipCardsApi.list({ page: 1, pageSize: 100 });
      if (!alive.value || request !== sequence.value) return;
      options.value = result.items.map(({ id, name, code }) => ({
        value: id,
        label: `${name}（${code}）`,
      }));
    } catch (reason) {
      if (!alive.value || request !== sequence.value) return;
      error.value =
        reason instanceof Error ? reason.message : '会员等级加载失败';
    } finally {
      if (alive.value && request === sequence.value) loading.value = false;
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      alive.value = false;
      sequence.value += 1;
    });
  }

  return { options, loading, error, load };
}
