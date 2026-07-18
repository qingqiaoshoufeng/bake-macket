import type {
  AdminOrderListQuery,
  AdminOrderListResult,
  OrderStatus,
  OrderStatusUpdateResult,
  OrderView,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

const toSearchParams = (query: AdminOrderListQuery): URLSearchParams =>
  new URLSearchParams(
    Object.entries(query)
      .filter((entry): entry is [string, string | number] => {
        const value = entry[1];
        return value !== undefined && value !== '';
      })
      .map(([key, value]) => [key, String(value)]),
  );

export const ordersApi = {
  list: (query: AdminOrderListQuery): Promise<AdminOrderListResult> =>
    apiClient.get(`/admin/orders?${toSearchParams(query).toString()}`),
  getOne: (id: string): Promise<OrderView> =>
    apiClient.get(`/admin/orders/${id}`),
  updateStatus: (
    id: string,
    status: OrderStatus,
  ): Promise<OrderStatusUpdateResult> =>
    apiClient.patch(`/admin/orders/${id}/status`, { status }),
};
