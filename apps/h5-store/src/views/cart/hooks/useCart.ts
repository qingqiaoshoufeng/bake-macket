import { computed } from 'vue';
import type { CartItemView, UpsertCartItemRequest } from '@bake-mall/contracts';

import { useCartStore } from '../../../stores/cart.js';
import { captureSession, isCurrentSession } from '../../../stores/session.js';
import { cartFeatureApi } from '../api/index.js';

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;
const addQueues = new WeakMap<object, Promise<unknown>>();

function clampQuantity(value: number): number {
  if (!Number.isFinite(value) || value < MIN_QUANTITY) return MIN_QUANTITY;
  if (value > MAX_QUANTITY) return MAX_QUANTITY;
  return Math.floor(value);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useCart() {
  const cart = useCartStore();
  const items = computed(() => cart.items);
  const availableItems = computed(() => cart.availableItems);
  const loading = computed(() => cart.loading);
  const totalCents = computed(() =>
    availableItems.value.reduce(
      (sum, item) => sum + item.sku.priceCents * item.quantity,
      0,
    ),
  );
  const itemCount = computed(() =>
    availableItems.value.reduce((sum, item) => sum + item.quantity, 0),
  );

  async function refresh(): Promise<CartItemView[]> {
    const session = captureSession();
    cart.setLoading(true);
    cart.setError(null);
    try {
      const nextItems = await cartFeatureApi.list();
      if (isCurrentSession(session)) cart.applyItems(nextItems);
      return nextItems;
    } catch (error) {
      if (isCurrentSession(session)) {
        cart.setError(errorMessage(error, '加载失败'));
      }
      throw error;
    } finally {
      if (isCurrentSession(session)) cart.setLoading(false);
    }
  }

  async function addLatest(
    payload: UpsertCartItemRequest,
  ): Promise<CartItemView> {
    const session = captureSession();
    if (!cart.hydrated) await refresh();
    if (!isCurrentSession(session)) {
      throw new Error('Session changed while updating cart');
    }
    const current = cart.items.find((item) => item.sku.id === payload.skuId);
    const target = Math.min(
      (current?.quantity ?? 0) + clampQuantity(payload.quantity),
      MAX_QUANTITY,
    );
    if (current?.quantity === target) return current;

    const item = await cartFeatureApi.upsert({
      skuId: payload.skuId,
      quantity: target,
    });
    if (isCurrentSession(session)) cart.applyItem(item);
    return item;
  }

  function add(payload: UpsertCartItemRequest): Promise<CartItemView> {
    const queue = addQueues.get(cart) ?? Promise.resolve();
    const operation = queue.then(() => addLatest(payload));
    addQueues.set(
      cart,
      operation.catch(() => undefined),
    );
    return operation;
  }

  async function setQuantity(
    id: string,
    quantity: number,
  ): Promise<CartItemView> {
    const target = clampQuantity(quantity);
    const cached = cart.items.find((item) => item.id === id);
    const current = cached ?? (await refresh()).find((item) => item.id === id);
    if (!current) throw new Error('Cart item not found');

    if (target === current.quantity) return current;

    const session = captureSession();
    const updated = await cartFeatureApi.upsert({
      skuId: current.sku.id,
      quantity: target,
    });
    if (isCurrentSession(session)) cart.applyItem(updated);
    return updated;
  }

  async function remove(id: string): Promise<void> {
    const session = captureSession();
    await cartFeatureApi.remove(id);
    if (isCurrentSession(session)) cart.removeItem(id);
  }

  return {
    data: { items, availableItems, totalCents, itemCount },
    loading,
    error: computed(() => cart.lastError),
    methods: { refresh, add, setQuantity, remove },
  };
}
