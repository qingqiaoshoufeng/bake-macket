import { apiClient } from './http.js';

/**
 * Wire-shape returned by `GET /api/v1/me/cart/items` and
 * `POST /api/v1/me/cart/items`.
 *
 * The backend's `CartService.toView` adds an `available` flag derived from
 * the live SKU/product state so the storefront can disable cart rows whose
 * underlying SKU was removed or sold out without a separate request.
 * `available` is not part of `@bake-mall/contracts` (it's a presentation
 * concern), so the type lives here rather than in the shared package.
 */
export type CartItemView = {
  id: string;
  quantity: number;
  available: boolean;
  sku: {
    id: string;
    name: string;
    attributes: Record<string, string>;
    priceCents: number;
    stock: number;
    imageUrl: string | null;
    isActive: boolean;
  };
  product: {
    id: string;
    name: string;
    coverImageUrl: string | null;
    isActive: boolean;
  };
};

export type UpsertCartItemRequest = {
  skuId: string;
  quantity: number;
};

export const customerApi = {
  /**
   * `GET /api/v1/me/cart/items` — fetch every cart row belonging to the
   * current user, newest-update first. Requires a valid user JWT.
   */
  listCart(): Promise<CartItemView[]> {
    return apiClient.get<CartItemView[]>('/me/cart/items');
  },

  /**
   * `POST /api/v1/me/cart/items` — upsert by `(userId, skuId)`. The
   * backend adds the supplied `quantity` to the existing row (clamped to
   * `[1, 99]`); callers that want to set an absolute value should compute
   * the delta against the current row first.
   */
  upsertCartItem(body: UpsertCartItemRequest): Promise<CartItemView> {
    return apiClient.post<CartItemView>('/me/cart/items', body);
  },

  /**
   * `DELETE /api/v1/me/cart/items/:id` — drop a cart row by primary key.
   * The backend returns `204 No Content`.
   */
  removeCartItem(id: string): Promise<void> {
    return apiClient.delete<void>(`/me/cart/items/${id}`);
  },
};
