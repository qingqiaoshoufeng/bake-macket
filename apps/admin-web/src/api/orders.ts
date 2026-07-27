import type { OrderStatus, OrderView } from '@bake-mall/contracts';

import { apiClient } from './http.js';

/**
 * Back-office order endpoints mounted under `/admin/*` and protected by
 * `JwtAdminGuard`.
 *
 * The admin surface deliberately exposes only the status mutation:
 * `PATCH /admin/orders/:id/status`. There is no PUT/PATCH for the order
 * body, so a merchant cannot rewrite the frozen snapshot
 * (contact / address / items) through the API client. {@link OrderDetailView}
 * is read-only and only fires status updates; the cancel warning explicitly
 * states `取消订单不会回补库存`.
 */

export type UpdateOrderStatusRequest = {
  status: OrderStatus;
};

/**
 * `GET /api/v1/admin/orders` — list every order (no user filter). The
 * backend accepts a `?status=NEW|PROCESSING|COMPLETED|CANCELLED` query
 * parameter used by the OrdersView status filter chips.
 */
export const adminOrdersApi = {
  listOrders(status?: OrderStatus): Promise<OrderView[]> {
    const search = status ? `?status=${encodeURIComponent(status)}` : '';
    return apiClient.get<OrderView[]>(`/admin/orders${search}`);
  },

  /**
   * `GET /api/v1/admin/orders/:id` — fetch a single order including the
   * immutable item snapshot. Used by {@link OrderDetailView}.
   */
  getOrder(id: string): Promise<OrderView> {
    return apiClient.get<OrderView>(`/admin/orders/${id}`);
  },

  /**
   * `PATCH /api/v1/admin/orders/:id/status` — the only mutation. Returns
   * the updated order so the caller can refresh its UI without a second
   * round-trip.
   */
  updateStatus(id: string, body: UpdateOrderStatusRequest): Promise<OrderView> {
    return apiClient.patch<OrderView>(`/admin/orders/${id}/status`, body);
  },
};
