import type {
  AdminOrderExportQuery,
  AdminOrderListQuery,
  AdminOrderListResult,
  AdminOrderSupplyDetailQuery,
  AdminOrderSupplyDetailResult,
  AdminOrderSupplyQuery,
  AdminOrderSupplyResult,
  OrderStatus,
  OrderStatusUpdateResult,
  OrderView,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';
import { compactQuery } from '../../../utils/list-query.js';

function toSearchParams(query: Record<string, unknown>): URLSearchParams {
  return Object.entries(compactQuery(query)).reduce((params, [key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => params.append(key, String(item)));
    return params;
  }, new URLSearchParams());
}

function withQuery(path: string, query: Record<string, unknown>): string {
  const search = toSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}

export const ordersApi = {
  list: (query: AdminOrderListQuery): Promise<AdminOrderListResult> =>
    apiClient.get(withQuery('/admin/orders', query)),
  listSupply: (query: AdminOrderSupplyQuery): Promise<AdminOrderSupplyResult> =>
    apiClient.get(withQuery('/admin/orders/supply', query)),
  listSupplyItems: (
    query: AdminOrderSupplyDetailQuery,
  ): Promise<AdminOrderSupplyDetailResult> =>
    apiClient.get(withQuery('/admin/orders/supply-items', query)),
  export: (query: AdminOrderExportQuery) =>
    apiClient.getBlob(withQuery('/admin/orders/export', query)),
  getOne: (id: string): Promise<OrderView> =>
    apiClient.get(`/admin/orders/${encodeURIComponent(id)}`),
  updateStatus: (
    id: string,
    status: OrderStatus,
  ): Promise<OrderStatusUpdateResult> =>
    apiClient.patch(`/admin/orders/${encodeURIComponent(id)}/status`, {
      status,
    }),
};
