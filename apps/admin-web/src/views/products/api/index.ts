import type {
  AdminProductDetailView,
  AdminProductSummaryView,
  SaveProductRequest,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

export const productsApi = {
  list: (): Promise<AdminProductSummaryView[]> =>
    apiClient.get('/admin/products'),
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
