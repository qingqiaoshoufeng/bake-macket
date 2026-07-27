import { useRouter } from 'vue-router';

import { DASHBOARD_ENTRIES } from '../config/entries.js';
import { ORDER_FLOW } from '../config/order-flow.js';

export function useDashboardNavigation() {
  const router = useRouter();

  async function openEntry(path: string): Promise<void> {
    await router.push(path);
  }

  return {
    entries: DASHBOARD_ENTRIES,
    orderFlow: ORDER_FLOW,
    openEntry,
  };
}
