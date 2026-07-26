import { computed } from 'vue';
import type { OrderView } from '@bake-mall/contracts';

import { useOrdersStore } from '../../../stores/orders.js';
import { captureSession, isCurrentSession } from '../../../stores/session.js';
import { ordersFeatureApi } from '../api/index.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '加载失败';
}

export function useOrderDetail() {
  const orders = useOrdersStore();
  let requestSequence = 0;

  async function load(id: string): Promise<OrderView> {
    const sequence = ++requestSequence;
    const session = captureSession();
    orders.applyCurrent(null);
    orders.setLoading(true);
    orders.setError(null);
    try {
      const order = await ordersFeatureApi.getOne(id);
      if (sequence === requestSequence && isCurrentSession(session))
        orders.applyCurrent(order);
      return order;
    } catch (error) {
      if (sequence === requestSequence && isCurrentSession(session))
        orders.setError(errorMessage(error));
      throw error;
    } finally {
      if (sequence === requestSequence && isCurrentSession(session))
        orders.setLoading(false);
    }
  }

  function clear(): void {
    requestSequence += 1;
    orders.applyCurrent(null);
    orders.setLoading(false);
    orders.setError(null);
  }

  return {
    data: { order: computed(() => orders.current) },
    loading: computed(() => orders.loading),
    error: computed(() => orders.lastError),
    methods: { load, clear },
  };
}
