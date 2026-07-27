import { defineStore } from 'pinia';
import type { OrderView } from '@bake-mall/contracts';

type OrdersState = {
  items: OrderView[];
  current: OrderView | null;
  loading: boolean;
  submitting: boolean;
  lastError: string | null;
};

export const useOrdersStore = defineStore('orders', {
  state: (): OrdersState => ({
    items: [],
    current: null,
    loading: false,
    submitting: false,
    lastError: null,
  }),
  actions: {
    applyItems(items: readonly OrderView[]): void {
      this.items = [...items];
    },
    applyCurrent(order: OrderView | null): void {
      this.current = order;
    },
    setLoading(loading: boolean): void {
      this.loading = loading;
    },
    setSubmitting(submitting: boolean): void {
      this.submitting = submitting;
    },
    setError(error: string | null): void {
      this.lastError = error;
    },
  },
});

export type OrdersStore = ReturnType<typeof useOrdersStore>;
