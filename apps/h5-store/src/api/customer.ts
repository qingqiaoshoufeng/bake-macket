import type { UserProfileView } from '@bake-mall/contracts';

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

/**
 * Wire-shape returned by every `/me/addresses` endpoint. The backend's
 * `Address` entity serialises directly with `id`, `recipient` (NOT
 * `receiverName`), `phone`, `province`, `city`, `district`, `detail`,
 * `isDefault`, plus timestamps. Phone is returned in clear text on
 * addresses (the mask only applies to `GET /me`).
 */
export type AddressView = {
  id: string;
  recipient: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateAddressRequest = {
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  isDefault?: boolean;
};

export type UpdateAddressRequest = Partial<CreateAddressRequest>;

/**
 * `GET /api/v1/me` returns the masked profile. The shared
 * `UserProfileView.phone` is always a masked string (or `null` when the
 * user hasn't bound a phone); `phoneVerified` is NOT part of the response
 * (only the dev login shape exposes it).
 */
export type MeView = Pick<
  UserProfileView,
  'id' | 'avatarUrl' | 'nickname' | 'phone'
>;

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

  /**
   * `GET /api/v1/me` — fetch the current user profile. The backend masks
   * the phone server-side (3+4+4 format) and intentionally omits the
   * `phoneVerified` flag so the storefront has to check the local
   * `useAuthStore.hasVerifiedPhone` state for guarded routes.
   */
  getMe(): Promise<MeView> {
    return apiClient.get<MeView>('/me');
  },

  /**
   * `GET /api/v1/me/addresses` — every address owned by the current user,
   * ordered by `isDefault DESC, createdAt DESC` so the default row is
   * always at the top.
   */
  listAddresses(): Promise<AddressView[]> {
    return apiClient.get<AddressView[]>('/me/addresses');
  },

  /**
   * `POST /api/v1/me/addresses` — create a new address. The DTO uses
   * `receiverName`; the response uses the entity field name `recipient`.
   * Setting `isDefault: true` is honored by the server within a
   * transaction that clears every other default for the user.
   */
  createAddress(body: CreateAddressRequest): Promise<AddressView> {
    return apiClient.post<AddressView>('/me/addresses', body);
  },

  /**
   * `PATCH /api/v1/me/addresses/:id` — partial update. Any field left
   * `undefined` is preserved. Sending `isDefault: true` will trigger the
   * same default-clearing transaction as create.
   */
  updateAddress(id: string, body: UpdateAddressRequest): Promise<AddressView> {
    return apiClient.patch<AddressView>(`/me/addresses/${id}`, body);
  },

  /**
   * `PATCH /api/v1/me/addresses/:id/default` — dedicated endpoint that
   * atomically clears every other default and marks this one. Takes no
   * body; the dedicated route exists so the toggle UI doesn't have to
   * PATCH the full record with `isDefault: true`.
   */
  setDefaultAddress(id: string): Promise<AddressView> {
    return apiClient.patch<AddressView>(`/me/addresses/${id}/default`, {});
  },

  /**
   * `DELETE /api/v1/me/addresses/:id` — drop an address by primary key.
   * The backend returns `204 No Content`.
   */
  removeAddress(id: string): Promise<void> {
    return apiClient.delete<void>(`/me/addresses/${id}`);
  },
};
