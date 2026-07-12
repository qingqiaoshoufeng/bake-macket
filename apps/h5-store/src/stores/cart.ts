import { defineStore } from 'pinia';

import { customerApi, type CartItemView } from '../api/customer.js';

type CartState = {
  items: CartItemView[];
  loading: boolean;
  lastError: string | null;
};

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;

/**
 * Customer-facing cart store.
 *
 * - `refresh()` pulls the live cart from `GET /me/cart/items` and hydrates
 *   `items` (newest-update first, server-side).
 * - `setQuantity(id, quantity)` updates the quantity of a single cart row
 *   by upserting through `POST /me/cart/items`. The backend treats this as
 *   a delta; the storefront clamps to `[1, 99]` and computes the delta
 *   against the locally-cached row so the resulting server quantity equals
 *   the requested absolute value.
 * - `remove(id)` issues `DELETE /me/cart/items/:id` and drops the row from
 *   `items` on success.
 *
 * The store deliberately keeps state narrow: callers that need a subtotal
 * or "available only" filter should derive them via getters on the view.
 */
export const useCartStore = defineStore('cart', {
  state: (): CartState => ({
    items: [],
    loading: false,
    lastError: null,
  }),
  getters: {
    availableItems: (state) => state.items.filter((item) => item.available),
  },
  actions: {
    /**
     * Clamp the requested absolute quantity into `[1, 99]`. Returns the
     * delta (relative to the current row) that should be sent to the
     * backend so the server-side `LEAST(99, quantity + delta)` lands on
     * the target value.
     */
    clampQuantity(value: number): number {
      if (!Number.isFinite(value)) return MIN_QUANTITY;
      if (value < MIN_QUANTITY) return MIN_QUANTITY;
      if (value > MAX_QUANTITY) return MAX_QUANTITY;
      return Math.floor(value);
    },

    async refresh(): Promise<CartItemView[]> {
      this.loading = true;
      this.lastError = null;
      try {
        const items = await customerApi.listCart();
        this.items = items;
        return items;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : '加载失败';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Refresh the cart and return the items array. Used by setQuantity to
     * rehydrate a row that other devices inserted after the current page
     * last hydrated the cart; the implementation must call refresh (rather
     * than re-reading `this.items`) so that setQuantity can fall back
     * gracefully when the local cache is empty or stale.
     */
    async rehydrate(): Promise<CartItemView[]> {
      return this.refresh();
    },

    /**
     * Set the absolute quantity of a cart row. The function clamps the
     * requested value, computes the delta against the locally-cached row
     * (defaulting to the target if no cache exists), and upserts. The new
     * server view replaces the local row so subsequent deltas stay
     * correct.
     */
    async setQuantity(id: string, quantity: number): Promise<CartItemView> {
      const target = this.clampQuantity(quantity);
      const current = this.items.find((item) => item.id === id);
      const delta = current === undefined ? target : target - current.quantity;
      if (delta === 0 && current) {
        return current;
      }
      let skuId = current?.sku.id;
      if (!skuId) {
        const refreshed = await this.rehydrate();
        const refreshedItem = refreshed.find((item) => item.id === id);
        if (!refreshedItem) {
          throw new Error('Cart item not found');
        }
        skuId = refreshedItem.sku.id;
      }
      const updated = await customerApi.upsertCartItem({
        skuId,
        quantity: delta,
      });
      const index = this.items.findIndex((item) => item.id === id);
      if (index >= 0) {
        this.items.splice(index, 1, updated);
      } else {
        this.items.unshift(updated);
      }
      return updated;
    },

    async remove(id: string): Promise<void> {
      await customerApi.removeCartItem(id);
      this.items = this.items.filter((item) => item.id !== id);
    },
  },
});

export type CartStore = ReturnType<typeof useCartStore>;
