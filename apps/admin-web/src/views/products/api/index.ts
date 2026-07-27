import type {
  AdminProductDetailView,
  AdminProductListQuery,
  AdminProductListResult,
  SaveProductRequest,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

const toSearchParams = (query: AdminProductListQuery): URLSearchParams =>
  new URLSearchParams(
    Object.entries(query)
      .filter((entry): entry is [string, string | number] => {
        const value = entry[1];
        return value !== undefined && value !== '';
      })
      .map(([key, value]) => [key, String(value)]),
  );

export const productsApi = {
  list: (query: AdminProductListQuery): Promise<AdminProductListResult> =>
    apiClient.get(`/admin/products?${toSearchParams(query).toString()}`),
  getOne: (id: string): Promise<AdminProductDetailView> =>
    apiClient.get(`/admin/products/${id}`),
  create: (body: SaveProductRequest): Promise<AdminProductDetailView> =>
    apiClient.post('/admin/products', body),
  replace: (
    id: string,
    body: SaveProductRequest,
  ): Promise<AdminProductDetailView> =>
    apiClient.put(`/admin/products/${id}`, body),
  remove: (id: string): Promise<void> =>
    apiClient.delete(`/admin/products/${id}`),
};
