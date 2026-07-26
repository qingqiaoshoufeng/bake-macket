import { defineStore } from 'pinia';
import type { CartItemView } from '@bake-mall/contracts';

type CartState = {
  items: CartItemView[];
  selectedItemIds: string[];
  hydrated: boolean;
  loading: boolean;
  lastError: string | null;
};

export const useCartStore = defineStore('cart', {
  state: (): CartState => ({
    items: [],
    selectedItemIds: [],
    hydrated: false,
    loading: false,
    lastError: null,
  }),
  getters: {
    availableItems: (state) => state.items.filter((item) => item.available),
    selectedItems: (state) =>
      state.items.filter(
        (item) => item.available && state.selectedItemIds.includes(item.id),
      ),
    allAvailableSelected(): boolean {
      return (
        this.availableItems.length > 0 &&
        this.availableItems.every((item) =>
          this.selectedItemIds.includes(item.id),
        )
      );
    },
  },
  actions: {
    applyItems(items: readonly CartItemView[]): void {
      const previousItemIds = new Set(this.items.map((item) => item.id));
      const previouslySelectedIds = new Set(this.selectedItemIds);
      this.items = [...items];
      this.selectedItemIds = items
        .filter(
          (item) =>
            item.available &&
            (!previousItemIds.has(item.id) ||
              previouslySelectedIds.has(item.id)),
        )
        .map((item) => item.id);
      this.hydrated = true;
    },
    applyItem(item: CartItemView): void {
      const exists = this.items.some((current) => current.id === item.id);
      this.items = exists
        ? this.items.map((current) => (current.id === item.id ? item : current))
        : [item, ...this.items];
      if (!exists && item.available) {
        this.selectedItemIds = [...this.selectedItemIds, item.id];
      }
      if (!item.available) {
        this.selectedItemIds = this.selectedItemIds.filter(
          (selectedId) => selectedId !== item.id,
        );
      }
    },
    removeItem(id: string): void {
      this.items = this.items.filter((item) => item.id !== id);
      this.selectedItemIds = this.selectedItemIds.filter(
        (selectedId) => selectedId !== id,
      );
    },
    setSelected(id: string, selected: boolean): void {
      const item = this.items.find((current) => current.id === id);
      if (!item?.available) return;
      this.selectedItemIds = selected
        ? Array.from(new Set([...this.selectedItemIds, id]))
        : this.selectedItemIds.filter((selectedId) => selectedId !== id);
    },
    setAllSelected(selected: boolean): void {
      this.selectedItemIds = selected
        ? this.items.filter((item) => item.available).map((item) => item.id)
        : [];
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
