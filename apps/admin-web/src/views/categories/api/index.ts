import type {
  AdminCategoryListQuery,
  AdminCategoryListResult,
} from '@bake-mall/contracts';

import { adminCatalogApi } from '../../../api/catalog.js';
import { apiClient } from '../../../api/http.js';

const toSearchParams = (query: AdminCategoryListQuery): URLSearchParams =>
  new URLSearchParams(
    Object.entries(query)
      .filter((entry): entry is [string, string | number] => {
        const value = entry[1];
        return value !== undefined && value !== '';
      })
      .map(([key, value]) => [key, String(value)]),
  );

export const categoriesApi = {
  list: (query: AdminCategoryListQuery): Promise<AdminCategoryListResult> =>
    apiClient.get(`/admin/categories?${toSearchParams(query).toString()}`),
  create: adminCatalogApi.createCategory.bind(adminCatalogApi),
  update: adminCatalogApi.updateCategory.bind(adminCatalogApi),
  remove: adminCatalogApi.deleteCategory.bind(adminCatalogApi),
};
