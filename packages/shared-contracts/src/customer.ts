export type CustomerProfileView = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  phone: string | null;
};

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
  /** Absolute target quantity, validated at runtime in the inclusive range 1..99. */
  quantity: number;
};

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
