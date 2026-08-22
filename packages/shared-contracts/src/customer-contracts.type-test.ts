import type {
  AddressView,
  CartItemView,
  CreateAddressRequest,
  CustomerAvatarPresignRequest,
  CustomerProfileView,
  UpdateAddressRequest,
  UpdateCustomerProfileRequest,
  UpsertCartItemRequest,
} from './index.js';

const profile: CustomerProfileView = {
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
};

const invalidUnconfiguredContact: CustomerProfileView = {
  ...profile,
  // @ts-expect-error 未配置联系号时不能携带脱敏号码。
  orderContactPhone: {
    configured: false,
    maskedPhone: '138****0000',
    version: 0,
  },
};

const invalidConfiguredContact: CustomerProfileView = {
  ...profile,
  // @ts-expect-error 已配置联系号必须携带脱敏号码。
  orderContactPhone: {
    configured: true,
    maskedPhone: null,
    version: 1,
  },
};

const cartItem: CartItemView = {
  id: 'cart-1',
  quantity: 2,
  available: true,
  sku: {
    id: 'sku-1',
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
};

const upsert: UpsertCartItemRequest = { skuId: 'sku-1', quantity: 99 };

// quantity 表示目标绝对数量，而非正负增量；1..99 的范围由 API DTO 运行时校验。
const absoluteQuantity: number = upsert.quantity;
const address: AddressView = {
  id: 'address-1',
  recipient: '小明',
  phone: '13800000000',
  province: '浙江省',
  city: '杭州市',
  district: '西湖区',
  detail: '文一西路 1 号',
  isDefault: true,
};
const createAddress: CreateAddressRequest = {
  receiverName: address.recipient,
  phone: address.phone,
  province: address.province,
  city: address.city,
  district: address.district,
  detail: address.detail,
  isDefault: address.isDefault,
};
const updateAddress: UpdateAddressRequest = { detail: '文一西路 2 号' };
const avatarPresign: CustomerAvatarPresignRequest = {
  fileName: 'avatar.png',
  contentType: 'image/png',
  sizeBytes: 1024,
};
const nicknameProfileUpdate: UpdateCustomerProfileRequest = {
  nickname: '蛋糕爱好者',
};
const avatarProfileUpdate: UpdateCustomerProfileRequest = {
  avatarObjectKey: 'users/1/avatars/generated.png',
};

// @ts-expect-error 资料 patch 不能为空。
const emptyProfileUpdate: UpdateCustomerProfileRequest = {};
const externalAvatarProfileUpdate: UpdateCustomerProfileRequest = {
  // @ts-expect-error 头像 URL 只能由服务端从 object key 派生。
  avatarUrl: 'https://attacker.example/avatar.png',
};
const scopedAvatarPresign: CustomerAvatarPresignRequest = {
  // @ts-expect-error 顾客头像预签名不能接受管理端 scope。
  scope: 'products',
  fileName: 'avatar.png',
  contentType: 'image/png',
  sizeBytes: 1024,
};
const userScopedAvatarPresign: CustomerAvatarPresignRequest = {
  // @ts-expect-error 顾客头像预签名不能接受客户端 userId。
  userId: 'another-user',
  fileName: 'avatar.png',
  contentType: 'image/png',
  sizeBytes: 1024,
};

const invalidCartItem: CartItemView = {
  ...cartItem,
  // @ts-expect-error 金额必须使用整数分 number，不能使用字符串。
  sku: { ...cartItem.sku, priceCents: '6800' },
};

// @ts-expect-error 创建地址必须包含 receiverName。
const invalidAddress: CreateAddressRequest = {
  phone: '13800000000',
  province: '浙江省',
  city: '杭州市',
  district: '西湖区',
  detail: '文一西路 1 号',
};

void [
  profile,
  invalidUnconfiguredContact,
  invalidConfiguredContact,
  cartItem,
  upsert,
  absoluteQuantity,
  address,
  createAddress,
  updateAddress,
  avatarPresign,
  nicknameProfileUpdate,
  avatarProfileUpdate,
  emptyProfileUpdate,
  externalAvatarProfileUpdate,
  scopedAvatarPresign,
  userScopedAvatarPresign,
  invalidCartItem,
  invalidAddress,
];
