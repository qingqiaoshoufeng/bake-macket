import type { CreateOrderRequest, OrderView } from '@bake-mall/contracts';

import { apiClient } from './http.js';

/**
 * `POST /api/v1/orders` — create an order for the current user.
 *
 * The backend requires the `Idempotency-Key` request header so a retried
 * POST resolves to the original order without re-decrementing stock or
 * re-clearing the cart. `apiClient.request` doesn't auto-inject the
 * header, so callers pass it via the `headers` option on every attempt
 * (using the same key on retries — see `useOrdersStore.create`).
 *
 * The request body is the discriminated union from `@bake-mall/contracts`:
 * `PICKUP` requires `pickupTimeText`, `DELIVERY` requires `addressId`.
 * `cartItemIds` are cart-row primary keys (not SKU ids), resolved by the
 * server into live SKUs at order time.
 */
export const ordersApi = {
  create(body: CreateOrderRequest, idempotencyKey: string): Promise<OrderView> {
    return apiClient.post<OrderView>('/orders', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  /**
   * `GET /api/v1/me/orders` — list the current user's orders, newest
   * first. The server returns the immutable order header + item snapshot,
   * so the detail screen never falls back to live catalog data.
   */
  listMine(): Promise<OrderView[]> {
    return apiClient.get<OrderView[]>('/me/orders');
  },

  /**
   * `GET /api/v1/me/orders/:id` — fetch a single order owned by the
   * current user. Returns `404` when the id doesn't belong to the caller.
   */
  getMine(id: string): Promise<OrderView> {
    return apiClient.get<OrderView>(`/me/orders/${id}`);
  },
};
