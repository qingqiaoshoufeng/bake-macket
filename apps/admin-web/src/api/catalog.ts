import type {
  CategoryView,
  ProductView,
  SkuView,
} from '@bake-mall/contracts';

import { apiClient } from './http.js';

/**
 * Wire-shape returned by `GET /api/v1/admin/categories`.
 *
 * The backend's `Category` entity serialises directly with `id`, `name`,
 * optional `imageUrl`, `sortOrder`, `isActive` and timestamps. `CategoryView`
 * in the shared contract declares only `id`, `name`, `imageUrl?`; the admin
 * surface also needs `sortOrder` and `isActive` so we widen the type here
 * rather than mutating the shared contract.
 */
export type AdminCategoryView = CategoryView & {
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateCategoryRequest = {
  name: string;
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpdateCategoryRequest = Partial<CreateCategoryRequest>;

/**
 * Wire-shape returned by `GET /api/v1/admin/products`. The list endpoint
 * hydrates the relation to `category` (used for the table's category column)
 * but does NOT include `skus` / `images`; only the detail endpoint does.
 *
 * `isActive`, `sortOrder` and the optional `summary`/`coverImageUrl` are
 * admin-only fields added to the shared `ProductView`.
 */
export type AdminProductView = ProductView & {
  isActive: boolean;
  sortOrder: number;
  category?: { id: string; name: string; isActive?: boolean };
};

/**
 * Admin SKU view. `isActive` is renamed to `enabled` per the brief's
 * editor contract: the SKU editor's checkbox drives the boolean column on
 * the backend through the `isActive` field.
 */
export type AdminSkuView = SkuView & {
  isActive: boolean;
};

export type CreateProductRequest = {
  name: string;
  summary?: string;
  categoryId: string;
  coverImageUrl?: string;
  detailHtml: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpdateProductRequest = Partial<CreateProductRequest>;

export type CreateSkuRequest = {
  name: string;
  attributes?: Record<string, string>;
  priceCents: number;
  stock: number;
  imageUrl?: string;
  isActive?: boolean;
};

export type UpdateSkuRequest = Partial<CreateSkuRequest>;

/**
 * Back-office catalog endpoints mounted under `/admin/*` and protected by
 * `JwtAdminGuard`. The admin bearer token is bound on the shared `apiClient`
 * by `useAdminAuthStore`, so callers do not pass it explicitly.
 */
export const adminCatalogApi = {
  /**
   * `GET /api/v1/admin/categories` — every category ordered by `sortOrder`
   * then `createdAt`. Used by {@link CategoriesView} to render the
   * management table.
   */
  listCategories(): Promise<AdminCategoryView[]> {
    return apiClient.get<AdminCategoryView[]>('/admin/categories');
  },

  /**
   * `POST /api/v1/admin/categories` — create a single-level category.
   * Returns the persisted row including the server-allocated id.
   */
  createCategory(body: CreateCategoryRequest): Promise<AdminCategoryView> {
    return apiClient.post<AdminCategoryView>('/admin/categories', body);
  },

  /**
   * `PATCH /api/v1/admin/categories/:id` — partial update. The brief's
   * inline edit only flips `name`, `sortOrder`, `imageUrl` and `isActive`.
   */
  updateCategory(
    id: string,
    body: UpdateCategoryRequest,
  ): Promise<AdminCategoryView> {
    return apiClient.patch<AdminCategoryView>(
      `/admin/categories/${id}`,
      body,
    );
  },

  /**
   * `DELETE /api/v1/admin/categories/:id` — drop a category by id. The
   * backend returns `200 OK` with no body.
   */
  deleteCategory(id: string): Promise<void> {
    return apiClient.delete<void>(`/admin/categories/${id}`);
  },

  /**
   * `GET /api/v1/admin/products` — every product (active and inactive) with
   * the category relation hydrated. The list is ordered by `sortOrder` then
   * `createdAt` so the merchant-side table mirrors the public sort.
   */
  listProducts(): Promise<AdminProductView[]> {
    return apiClient.get<AdminProductView[]>('/admin/products');
  },

  /**
   * `POST /api/v1/admin/products` — create a product. The server sanitises
   * `detailHtml` and rejects empty bodies via `class-validator`.
   */
  createProduct(body: CreateProductRequest): Promise<AdminProductView> {
    return apiClient.post<AdminProductView>('/admin/products', body);
  },

  /**
   * `PATCH /api/v1/admin/products/:id` — partial update. The product editor
   * reuses this for the title, summary, category, sort, status and detail
   * HTML fields. SKU mutations go through their own endpoints.
   */
  updateProduct(
    id: string,
    body: UpdateProductRequest,
  ): Promise<AdminProductView> {
    return apiClient.patch<AdminProductView>(`/admin/products/${id}`, body);
  },

  /**
   * `DELETE /api/v1/admin/products/:id` — drop a product by id.
   */
  deleteProduct(id: string): Promise<void> {
    return apiClient.delete<void>(`/admin/products/${id}`);
  },

  /**
   * `GET /api/v1/admin/products/:id/skus` — list every SKU (active and
   * inactive) attached to a product. Drives the SKU editor table.
   */
  listSkus(productId: string): Promise<AdminSkuView[]> {
    return apiClient.get<AdminSkuView[]>(
      `/admin/products/${productId}/skus`,
    );
  },

  /**
   * `POST /api/v1/admin/products/:id/skus` — append a SKU. Validation lives
   * on the server; `priceCents` and `stock` must be non-negative integers.
   */
  createSku(
    productId: string,
    body: CreateSkuRequest,
  ): Promise<AdminSkuView> {
    return apiClient.post<AdminSkuView>(
      `/admin/products/${productId}/skus`,
      body,
    );
  },

  /**
   * `PATCH /api/v1/admin/products/:id/skus/:skuId` — partial update.
   */
  updateSku(
    productId: string,
    skuId: string,
    body: UpdateSkuRequest,
  ): Promise<AdminSkuView> {
    return apiClient.patch<AdminSkuView>(
      `/admin/products/${productId}/skus/${skuId}`,
      body,
    );
  },

  /**
   * `DELETE /api/v1/admin/products/:id/skus/:skuId` — drop a SKU by id.
   */
  deleteSku(productId: string, skuId: string): Promise<void> {
    return apiClient.delete<void>(
      `/admin/products/${productId}/skus/${skuId}`,
    );
  },
};