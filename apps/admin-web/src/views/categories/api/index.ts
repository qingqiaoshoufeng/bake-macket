/**
 * Per-feature API composition for the category management view.
 *
 * The shared {@link adminCatalogApi} layer under `apps/admin-web/src/api/`
 * already wraps the global `apiClient`; this file *only* re-exports the
 * specific operations used by the view so other modules can depend on a
 * narrow surface. No payload reshaping, no status-code branching —
 * those would belong to a hook instead.
 */

import { adminCatalogApi } from '../../../api/catalog.js';

export const categoriesApi = {
  list: () => adminCatalogApi.listCategories(),
  create: adminCatalogApi.createCategory.bind(adminCatalogApi),
  update: adminCatalogApi.updateCategory.bind(adminCatalogApi),
  remove: adminCatalogApi.deleteCategory.bind(adminCatalogApi),
};
