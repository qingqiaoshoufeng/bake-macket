import type { AdminProductSummaryView } from '@bake-mall/contracts';
import { ref, type Ref } from 'vue';

import { productsApi } from '../api/index.js';

export type UseProductsListResult = {
  readonly products: Ref<readonly AdminProductSummaryView[]>;
  readonly loading: Ref<boolean>;
  readonly deletingId: Ref<string | null>;
  readonly lastError: Ref<string | null>;
  readonly refresh: () => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
};

export function useProductsList(): UseProductsListResult {
  const products = ref<readonly AdminProductSummaryView[]>([]);
  const loading = ref(false);
  const deletingId = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  const refreshSequence = ref(0);

  async function refresh(): Promise<void> {
    const requestSequence = refreshSequence.value + 1;
    refreshSequence.value = requestSequence;
    loading.value = true;
    lastError.value = null;

    try {
      const result = await productsApi.list();
      if (requestSequence === refreshSequence.value) {
        products.value = [...result];
      }
    } catch {
      if (requestSequence === refreshSequence.value) {
        lastError.value = '商品加载失败，请重试';
      }
    } finally {
      if (requestSequence === refreshSequence.value) {
        loading.value = false;
      }
    }
  }

  async function remove(id: string): Promise<void> {
    deletingId.value = id;
    try {
      await productsApi.remove(id);
      await refresh();
    } finally {
      if (deletingId.value === id) {
        deletingId.value = null;
      }
    }
  }

  return { products, loading, deletingId, lastError, refresh, remove };
}
