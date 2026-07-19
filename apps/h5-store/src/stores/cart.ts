import { defineStore } from 'pinia';
import type { CartItemView } from '@bake-mall/contracts';

type CartState = {
  items: CartItemView[];
  hydrated: boolean;
  loading: boolean;
  lastError: string | null;
};

export const useCartStore = defineStore('cart', {
  state: (): CartState => ({
    items: [],
    hydrated: false,
    loading: false,
    lastError: null,
  }),
  getters: {
    availableItems: (state) => state.items.filter((item) => item.available),
  },
  actions: {
    applyItems(items: readonly CartItemView[]): void {
      this.items = [...items];
      this.hydrated = true;
    },
    applyItem(item: CartItemView): void {
      const exists = this.items.some((current) => current.id === item.id);
      this.items = exists
        ? this.items.map((current) => (current.id === item.id ? item : current))
        : [item, ...this.items];
    },
    removeItem(id: string): void {
      this.items = this.items.filter((item) => item.id !== id);
    },
    setLoading(loading: boolean): void {
      this.loading = loading;
    },
    setError(error: string | null): void {
      this.lastError = error;
    },
  },
});

export type CartStore = ReturnType<typeof useCartStore>;
