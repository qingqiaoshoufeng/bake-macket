import type {
  BannerView,
  CategoryView,
  ProductView,
  SkuView,
} from '@bake-mall/contracts';

import { apiClient } from './http.js';

/**
 * Wire-shape returned by `GET /api/v1/public/products` and
 * `GET /api/v1/public/products/:id`.
 *
 * The backend's `CatalogService` returns hydrated TypeORM rows where the
 * price-bearing variant data lives on `skus`. The shared contract type
 * `ProductView` declares `skus: SkuView[]` and `images: ProductImageView[]`,
 * but in practice the list endpoint may not populate `images` (only the
 * detail endpoint does). The storefront only reads `skus` / `images` when
 * they are present, so we widen `ProductView` to mark both as optional —
 * the contract type is still imported for the rest of the row.
 */
export type ProductListItem = Omit<ProductView, 'skus' | 'images'> & {
  skus?: SkuView[];
  images?: ProductView['images'];
};

/**
 * Wire-shape returned by `GET /api/v1/public/categories`.
 *
 * The backend's `Category` entity stores `name`, optional `imageUrl`,
 * `sortOrder` and `isActive`. `imageUrl` is the only field beyond the
 * contract's `CategoryView` and is left as the optional field declared in
 * the shared type.
 */
export type CategoryListItem = CategoryView;

export const catalogApi = {
  /**
   * `GET /api/v1/public/banners` — only active banners whose target is
   * still live are returned (the backend filters out inactive products,
   * inactive categories and `BannerTargetType.NONE` banners that somehow
   * carry a target id).
   */
  listBanners(): Promise<BannerView[]> {
    return apiClient.get<BannerView[]>('/public/banners');
  },

  /**
   * `GET /api/v1/public/categories` — every active single-level category
   * ordered by `sortOrder`.
   */
  listCategories(): Promise<CategoryListItem[]> {
    return apiClient.get<CategoryListItem[]>('/public/categories');
  },

  /**
   * `GET /api/v1/public/products` — list active products. Both `categoryId`
   * and `q` are optional: with neither, the response is the global hot
   * product feed; with one, the storefront filters down server-side.
   */
  listProducts(params: { categoryId?: string; q?: string } = {}): Promise<
    ProductListItem[]
  > {
    const search = new URLSearchParams();
    if (params.categoryId) search.set('categoryId', params.categoryId);
    if (params.q) search.set('q', params.q);
    const query = search.toString();
    return apiClient.get<ProductListItem[]>(
      query ? `/public/products?${query}` : '/public/products',
    );
  },

  /**
   * `GET /api/v1/public/products/:id` — full product detail including the
   * `skus` array and `images` carousel.
   */
  getProduct(id: string): Promise<ProductListItem> {
    return apiClient.get<ProductListItem>(`/public/products/${id}`);
  },
};