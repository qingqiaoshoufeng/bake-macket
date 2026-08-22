import { describe, expect, it } from 'vitest';

import type {
  AddressView,
  CartItemView,
  CreateAddressRequest,
  CustomerAvatarPresignRequest,
  CustomerAvatarPresignResponse,
  CustomerProfileView,
  UpdateAddressRequest,
  UpdateCustomerProfileRequest,
  UpsertCartItemRequest,
} from './index.js';

describe('customer boundary contracts', () => {
  it('keeps the masked customer profile wire shape nullable', () => {
    const profile = {
      id: 'user-1',
      nickname: null,
      avatarUrl: null,
      phone: '138****0000',
      phoneVerified: true,
      profileCompleted: false,
      orderContactPhone: {
        configured: true,
        maskedPhone: '138****0000',
        version: 1,
      },
    } satisfies CustomerProfileView;

    expect(profile.phone).toBe('138****0000');
    expect(profile.orderContactPhone.configured).toBe(true);
    expect(profile.nickname).toBeNull();
    expect(profile.profileCompleted).toBe(false);
  });

  it('keeps avatar presign and non-empty profile update requests customer-scoped', () => {
    const presign = {
      fileName: 'avatar.webp',
      contentType: 'image/webp',
      sizeBytes: 1024,
    } satisfies CustomerAvatarPresignRequest;
    const response = {
      objectKey: 'users/1/avatars/server-generated.webp',
      uploadUrl: 'https://storage.example.test/upload',
      fields: { key: 'users/1/avatars/server-generated.webp' },
      expiresAt: '2026-08-18T08:05:00.000Z',
    } satisfies CustomerAvatarPresignResponse;
    const nickname = {
      nickname: ' 蛋糕爱好者 ',
    } satisfies UpdateCustomerProfileRequest;
    const avatar = {
      avatarObjectKey: response.objectKey,
    } satisfies UpdateCustomerProfileRequest;

    expect(presign).not.toHaveProperty('scope');
    expect(response).not.toHaveProperty('publicUrl');
    expect(nickname.nickname).toContain('蛋糕');
    expect(avatar.avatarObjectKey).toBe(response.objectKey);
  });

  it('keeps cart target quantities and prices as integer wire values', () => {
    const request: UpsertCartItemRequest = { skuId: 'sku-1', quantity: 2 };
    const item = {
      id: 'cart-1',
      quantity: request.quantity,
      available: true,
      sku: {
        id: request.skuId,
        name: '6寸',
        attributes: { size: '6寸' },
        priceCents: 6800,
        stock: 3,
        imageUrl: null,
        isActive: true,
      },
      product: {
        id: 'product-1',
        name: '草莓蛋糕',
        coverImageUrl: null,
        isActive: true,
      },
    } satisfies CartItemView;

    expect(Number.isInteger(item.quantity)).toBe(true);
    expect(Number.isInteger(item.sku.priceCents)).toBe(true);
  });

  it('keeps address response and create/update request field names distinct', () => {
    const address = {
      id: 'address-1',
      recipient: '小明',
      phone: '13800000000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail: '文一西路 1 号',
      isDefault: true,
    } satisfies AddressView;
    const create = {
      receiverName: address.recipient,
      phone: address.phone,
      province: address.province,
      city: address.city,
      district: address.district,
      detail: address.detail,
      isDefault: address.isDefault,
    } satisfies CreateAddressRequest;
    const update = { detail: '文一西路 2 号' } satisfies UpdateAddressRequest;

    expect(create.receiverName).toBe(address.recipient);
    expect(update).not.toHaveProperty('receiverName');
  });
});
