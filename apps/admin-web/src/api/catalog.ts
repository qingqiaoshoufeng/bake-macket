import type { AdminCategoryView } from '@bake-mall/contracts';

import { apiClient } from './http.js';

export type { AdminCategoryView } from '@bake-mall/contracts';

export type CreateCategoryRequest = {
  name: string;
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpdateCategoryRequest = Partial<CreateCategoryRequest>;

/**
 * Back-office category endpoints mounted under `/admin/*` and protected by
 * `JwtAdminGuard`. The admin bearer token is bound on the shared `apiClient`
 * by `useAdminAuthStore`, so callers do not pass it explicitly.
 */
export const adminCatalogApi = {
  listCategories(): Promise<AdminCategoryView[]> {
    return apiClient.get<AdminCategoryView[]>('/admin/categories');
  },

  createCategory(body: CreateCategoryRequest): Promise<AdminCategoryView> {
    return apiClient.post<AdminCategoryView>('/admin/categories', body);
  },

  updateCategory(
    id: string,
    body: UpdateCategoryRequest,
  ): Promise<AdminCategoryView> {
    return apiClient.patch<AdminCategoryView>(`/admin/categories/${id}`, body);
  },

  deleteCategory(id: string): Promise<void> {
    return apiClient.delete<void>(`/admin/categories/${id}`);
  },
};
