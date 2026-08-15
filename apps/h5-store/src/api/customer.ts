import type {
  AddressView,
  CartItemView,
  CreateAddressRequest,
  CustomerProfileView,
  UpdateAddressRequest,
  UpdateOrderContactPhoneRequest,
  UpdateOrderContactPhoneResponse,
  UpsertCartItemRequest,
} from '@bake-mall/contracts';

import { apiClient } from './http.js';

export const customerApi = {
  listCart(): Promise<CartItemView[]> {
    return apiClient.get<CartItemView[]>('/me/cart/items');
  },

  upsertCartItem(
    body: UpsertCartItemRequest,
    idempotencyKey?: string,
  ): Promise<CartItemView> {
    return apiClient.post<CartItemView>('/me/cart/items', body, {
      ...(idempotencyKey
        ? { headers: { 'Idempotency-Key': idempotencyKey } }
        : {}),
    });
  },

  removeCartItem(id: string): Promise<void> {
    return apiClient.delete<void>(`/me/cart/items/${id}`);
  },

  getMe(token?: string): Promise<CustomerProfileView> {
    return apiClient.get<CustomerProfileView>('/me', { token });
  },

  updateOrderContactPhone(
    body: UpdateOrderContactPhoneRequest,
  ): Promise<UpdateOrderContactPhoneResponse> {
    return apiClient.request<UpdateOrderContactPhoneResponse>(
      '/me/order-contact-phone',
      { method: 'PUT', body },
    );
  },

  listAddresses(): Promise<AddressView[]> {
    return apiClient.get<AddressView[]>('/me/addresses');
  },

  createAddress(body: CreateAddressRequest): Promise<AddressView> {
    return apiClient.post<AddressView>('/me/addresses', body);
  },

  updateAddress(id: string, body: UpdateAddressRequest): Promise<AddressView> {
    return apiClient.patch<AddressView>(`/me/addresses/${id}`, body);
  },

  setDefaultAddress(id: string): Promise<AddressView> {
    return apiClient.patch<AddressView>(`/me/addresses/${id}/default`, {});
  },

  removeAddress(id: string): Promise<void> {
    return apiClient.delete<void>(`/me/addresses/${id}`);
  },
};
