import { computed } from 'vue';
import type { OrderView } from '@bake-mall/contracts';

import { useOrdersStore } from '../../../stores/orders.js';
import { captureSession, isCurrentSession } from '../../../stores/session.js';
import { ordersFeatureApi } from '../api/index.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '加载失败';
}

export function useOrderList() {
  const orders = useOrdersStore();

  async function refresh(): Promise<OrderView[]> {
    const session = captureSession();
    orders.setLoading(true);
    orders.setError(null);
    try {
      const items = await ordersFeatureApi.list();
      if (isCurrentSession(session)) orders.applyItems(items);
      return items;
    } catch (error) {
      if (isCurrentSession(session)) orders.setError(errorMessage(error));
      throw error;
    } finally {
      if (isCurrentSession(session)) orders.setLoading(false);
    }
  }

  return {
    data: { items: computed(() => orders.items) },
    loading: computed(() => orders.loading),
    error: computed(() => orders.lastError),
    methods: { refresh },
  };
}
