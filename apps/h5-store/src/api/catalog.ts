import type {
  BannerView,
  CategoryView,
  PublicProductDetailView,
  PublicProductSummaryView,
} from '@bake-mall/contracts';

import { apiClient } from './http.js';

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
  listProducts(
    params: { categoryId?: string; q?: string } = {},
  ): Promise<PublicProductSummaryView[]> {
    const search = new URLSearchParams();
    if (params.categoryId) search.set('categoryId', params.categoryId);
    if (params.q) search.set('q', params.q);
    const query = search.toString();
    return apiClient.get<PublicProductSummaryView[]>(
      query ? `/public/products?${query}` : '/public/products',
    );
  },

  /**
   * `GET /api/v1/public/products/:id` — full product detail including the
   * `skus` array and `images` carousel.
   */
  getProduct(id: string): Promise<PublicProductDetailView> {
    return apiClient.get<PublicProductDetailView>(`/public/products/${id}`);
  },
};
