import {
  AdminOrderExportView,
  AdminOrderSupplyMatchType,
  AdminPermission,
  AdminRole,
  ApiErrorCode,
  FulfillmentType,
  BannerTargetType,
  OrderStatus,
  ProductStockFilter,
  OPERATOR_PERMISSIONS,
  type AdminBannerView,
  type AdminLoginRequest,
  type AdminOrderExportQuery,
  type AdminOrderListItem,
  type AdminOrderListQuery,
  type AdminOrderSupplyDetailItem,
  type AdminOrderSupplyItem,
  type AdminOrderSupplyDetailQuery,
  type AdminOrderSupplyQuery,
  type AdminProductListQuery,
  type AdminProductDetailView,
  type AdminSessionView,
  type AdminUserListItem,
  type AdminUserListQuery,
  type ChangeAdminPasswordRequest,
  type ChangeInitialOperatorPasswordRequest,
  type ExchangeOperatorSessionRequest,
  type FullSuperAdminSessionView,
  type GrantOperatorRequest,
  type OperatorLoginRequest,
  type SuperAdminLoginRequest,
  type MediaAsset,
  type PresignUploadResponse,
  type PublicProductDetailView,
  type PublicProductSummaryView,
  type SaveBannerRequest,
  type SaveProductRequest,
  type SaveProductSkuInput,
} from './index.js';

const superAdminLogin: AdminLoginRequest = {
  kind: 'SUPER_ADMIN',
  email: 'admin@example.com',
  password: 'secret',
};
const operatorLogin: AdminLoginRequest = {
  kind: 'OPERATOR',
  phone: '13800000000',
  password: 'secret',
};

class SuperAdminLoginDto implements SuperAdminLoginRequest {
  kind = 'SUPER_ADMIN' as const;
  email = 'admin@example.com';
  password = 'secret';
}

class OperatorLoginDto implements OperatorLoginRequest {
  kind = 'OPERATOR' as const;
  phone = '13800000000';
  password = 'secret';
}

class ExchangeOperatorSessionDto implements ExchangeOperatorSessionRequest {}

const exchangeWithExtraField: ExchangeOperatorSessionRequest = {
  // @ts-expect-error 空交换请求的对象字面量不得携带额外字段。
  unexpected: true,
};

const listedUser: AdminUserListItem = {
  id: 'user-1',
  nickname: '张三',
  phoneMasked: '138****0000',
  phoneVerified: true,
  createdAt: '2026-08-04T00:00:00.000Z',
  isOperator: false,
  operatorActive: false,
  mustChangePassword: false,
};

const listedUserWithRawPhone: AdminUserListItem = {
  id: 'user-1',
  nickname: '张三',
  phoneMasked: '138****0000',
  // @ts-expect-error 管理端用户列表响应不得暴露原始手机号。
  phone: '13800000000',
  phoneVerified: true,
  createdAt: '2026-08-04T00:00:00.000Z',
  isOperator: false,
  operatorActive: false,
  mustChangePassword: false,
};

const listSearch: AdminUserListQuery = {
  q: '13800000000',
  page: 1,
  pageSize: 20,
};

// @ts-expect-error 管理员登录必须通过 kind 明确身份类型。
const loginWithoutKind: AdminLoginRequest = {
  email: 'admin@example.com',
  password: 'secret',
};

// @ts-expect-error SUPER_ADMIN 登录不得混入 OPERATOR 手机号。
const loginWithMixedIdentityFields: AdminLoginRequest = {
  kind: 'SUPER_ADMIN',
  email: 'admin@example.com',
  phone: '13800000000',
  password: 'secret',
};

// @ts-expect-error 修改管理员密码必须同时提供当前密码、新密码和确认值。
const incompletePasswordChange: ChangeAdminPasswordRequest = {
  currentPassword: 'temporary',
  newPassword: 'new-password',
};

// @ts-expect-error 首次改密必须提交临时密码、新密码和确认值。
const incompleteInitialPasswordChange: ChangeInitialOperatorPasswordRequest = {
  temporaryPassword: '123456',
  newPassword: '654321',
};

const wrongInitialPasswordField: ChangeInitialOperatorPasswordRequest = {
  // @ts-expect-error 首次改密字段不能误用普通改密的 currentPassword。
  currentPassword: '123456',
  newPassword: '654321',
  confirmPassword: '654321',
};

// @ts-expect-error 授权 OPERATOR 必须确认临时密码。
const grantWithoutConfirmation: GrantOperatorRequest = {
  currentPassword: 'super-admin-password',
  temporaryPassword: 'temporary-password',
};

const restrictedOperatorSession: AdminSessionView = {
  accessToken: 'restricted-token',
  expiresAt: '2026-08-04T00:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: [],
  mustChangePassword: true,
};
const fullOperatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2026-08-04T00:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

// @ts-expect-error SUPER_ADMIN 不存在 mustChangePassword 为 true 的受限会话。
const restrictedSuperAdminSession: AdminSessionView = {
  accessToken: 'restricted-super-admin-token',
  expiresAt: '2026-08-04T00:00:00.000Z',
  role: AdminRole.SUPER_ADMIN,
  permissions: [],
  mustChangePassword: true,
};

const assertRestrictedSessionNarrowing = (session: AdminSessionView): void => {
  if (session.mustChangePassword) {
    const role: AdminRole.OPERATOR = session.role;
    const permissions: readonly [] = session.permissions;
    void [role, permissions];
  }
};

const emptySuperAdminSession: FullSuperAdminSessionView = {
  accessToken: 'super-admin-token',
  expiresAt: '2026-08-04T00:00:00.000Z',
  role: AdminRole.SUPER_ADMIN,
  // @ts-expect-error SUPER_ADMIN 会话不得缺少完整权限。
  permissions: [],
  mustChangePassword: false,
};

const partialSuperAdminSession: FullSuperAdminSessionView = {
  accessToken: 'super-admin-token',
  expiresAt: '2026-08-04T00:00:00.000Z',
  role: AdminRole.SUPER_ADMIN,
  // @ts-expect-error SUPER_ADMIN 会话不得只携带部分权限。
  permissions: [AdminPermission.ORDER_READ],
  mustChangePassword: false,
};

const incompleteOperatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2026-08-04T00:00:00.000Z',
  role: AdminRole.OPERATOR,
  // @ts-expect-error 完整 OPERATOR 会话必须携带完整且有序的白名单。
  permissions: [AdminPermission.ORDER_READ],
  mustChangePassword: false,
};

const invalidRestrictedSession: AdminSessionView = {
  accessToken: 'restricted-token',
  expiresAt: '2026-08-04T00:00:00.000Z',
  role: AdminRole.OPERATOR,
  // @ts-expect-error 受限会话不得携带 permission。
  permissions: [AdminPermission.ORDER_READ],
  mustChangePassword: true,
};

const image: MediaAsset = {
  objectKey: 'products/cake.webp',
  publicUrl: 'https://cdn.example.com/products/cake.webp',
};

const upload: PresignUploadResponse = {
  ...image,
  uploadUrl: 'http://127.0.0.1:9000/bake-mall',
  fields: { key: image.objectKey },
  expiresAt: '2026-07-16T00:05:00.000Z',
};

const saveProduct = {} as SaveProductRequest;
const product = {} as AdminProductDetailView;
const orderQuery = {} as AdminOrderListQuery;
const validSupply: AdminOrderSupplyQuery = {
  supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
  page: 1,
  pageSize: 20,
};
const validSupplyDetail: AdminOrderSupplyDetailQuery = {
  groupKey: 'sku:1',
  supplyStatuses: [OrderStatus.NEW],
  page: 1,
  pageSize: 50,
};
const adminOrderListItem: AdminOrderListItem = {
  id: 'order-1',
  orderNo: 'BM2026072800000001',
  userId: 'user-1',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '张三',
  contactPhone: '13800000000',
  itemLineCount: 2,
  totalQuantity: 3,
  goodsTotalCents: 6800,
  membershipDiscountCents: 680,
  creditAppliedCents: 500,
  payableTotalCents: 5620,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};
const adminOrderSupplyItem: AdminOrderSupplyItem = {
  groupKey: 'sku:1',
  matchType: AdminOrderSupplyMatchType.SKU_ID,
  productName: '草莓蛋糕',
  skuName: '6寸',
  skuAttributes: { size: '6寸' },
  requiredQuantity: 3,
  orderCount: 2,
  newQuantity: 1,
  processingQuantity: 2,
  earliestOrderCreatedAt: '2026-07-28T00:00:00.000Z',
};
const adminOrderSupplyDetailItem: AdminOrderSupplyDetailItem = {
  orderItemId: 'item-1',
  orderId: 'order-1',
  orderNo: 'BM2026072800000001',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '张三',
  contactPhone: '13800000000',
  productName: '草莓蛋糕',
  skuName: '6寸',
  skuAttributes: { size: '6寸' },
  quantity: 3,
  unitPriceCents: 6800,
  lineGoodsTotalCents: 20400,
  lineMembershipDiscountCents: 2040,
  linePayableCents: 18360,
  orderCreatedAt: '2026-07-28T00:00:00.000Z',
};

// @ts-expect-error 列表订单的三个金额和商品数量均为必填。
const invalidAdminOrderMissingAmounts: AdminOrderListItem = {
  id: 'order-1',
  orderNo: 'BM2026072800000001',
  userId: 'user-1',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '张三',
  contactPhone: '13800000000',
  itemLineCount: 2,
  totalQuantity: 3,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

// @ts-expect-error 供货汇总必须提供 requiredQuantity。
const invalidSupplyMissingQuantity: AdminOrderSupplyItem = {
  groupKey: 'sku:1',
  matchType: AdminOrderSupplyMatchType.SKU_ID,
  productName: '草莓蛋糕',
  skuName: '6寸',
  skuAttributes: { size: '6寸' },
  orderCount: 2,
  newQuantity: 1,
  processingQuantity: 2,
  earliestOrderCreatedAt: '2026-07-28T00:00:00.000Z',
};

// @ts-expect-error 供货明细必须提供会员折后金额。
const invalidSupplyDetailMissingLinePayable: AdminOrderSupplyDetailItem = {
  orderItemId: 'item-1',
  orderId: 'order-1',
  orderNo: 'BM2026072800000001',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '张三',
  contactPhone: '13800000000',
  productName: '草莓蛋糕',
  skuName: '6寸',
  skuAttributes: { size: '6寸' },
  quantity: 3,
  unitPriceCents: 6800,
  lineGoodsTotalCents: 20400,
  lineMembershipDiscountCents: 2040,
  orderCreatedAt: '2026-07-28T00:00:00.000Z',
};
const validOrderExport: AdminOrderExportQuery = {
  view: AdminOrderExportView.ORDER,
  status: OrderStatus.COMPLETED,
};
const validSupplyExport: AdminOrderExportQuery = {
  view: AdminOrderExportView.SUPPLY,
  supplyStatuses: [OrderStatus.NEW],
};

const invalidSupplyStatus: AdminOrderSupplyQuery = {
  // @ts-expect-error 供货查询只允许 NEW / PROCESSING。
  supplyStatuses: [OrderStatus.COMPLETED],
  page: 1,
  pageSize: 20,
};

// @ts-expect-error 供货导出必须显式携带供货状态。
const missingSupplyStatuses: AdminOrderExportQuery = {
  view: AdminOrderExportView.SUPPLY,
};

const invalidOrderExport: AdminOrderExportQuery = {
  view: AdminOrderExportView.ORDER,
  // @ts-expect-error 订单导出不能携带供货状态。
  supplyStatuses: [OrderStatus.NEW],
};

// @ts-expect-error 供货导出不能携带订单状态。
const invalidSupplyExport: AdminOrderExportQuery = {
  view: AdminOrderExportView.SUPPLY,
  supplyStatuses: [OrderStatus.PROCESSING],
  status: OrderStatus.NEW,
};
const productQuery: AdminProductListQuery = {
  q: '蛋糕',
  stock: ProductStockFilter.LOW_STOCK,
  lowStockThreshold: 10,
  minPriceCents: 1000,
  maxPriceCents: 5000,
  page: 1,
  pageSize: 20,
};
const invalidProductQuery: AdminProductListQuery = {
  // @ts-expect-error stock 只接受 ProductStockFilter。
  stock: 'LOW',
  page: 1,
  pageSize: 20,
};
const banner: SaveBannerRequest = {
  image,
  targetType: BannerTargetType.NONE,
  sortOrder: 0,
  isActive: true,
};
const bannerView = {} as AdminBannerView;
const legacyBannerView: AdminBannerView = {
  id: 'banner-legacy',
  image: null,
  targetType: BannerTargetType.NONE,
  sortOrder: 0,
  isActive: false,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

// @ts-expect-error NONE banners forbid targetId.
const invalidBanner: SaveBannerRequest = {
  image,
  targetType: BannerTargetType.NONE,
  targetId: 'product-1',
  sortOrder: 0,
  isActive: true,
};

const newSku: SaveProductSkuInput = {
  name: '6寸',
  attributes: { size: '6寸' },
  priceCents: 6800,
  stock: 0,
  isActive: true,
  image: null,
};

const existingSku: SaveProductSkuInput = {
  id: 'sku-1',
  stockVersion: 3,
  name: '8寸',
  attributes: { size: '8寸' },
  priceCents: 8800,
  stock: 2,
  isActive: true,
  image,
};

// @ts-expect-error 已有 SKU 必须携带 stockVersion。
const existingSkuWithoutVersion: SaveProductSkuInput = {
  id: 'sku-1',
  name: '8寸',
  attributes: {},
  priceCents: 8800,
  stock: 2,
  isActive: true,
  image: null,
};

// @ts-expect-error 新 SKU 不得单独携带 stockVersion。
const newSkuWithVersion: SaveProductSkuInput = {
  stockVersion: 1,
  name: '新规格',
  attributes: {},
  priceCents: 1000,
  stock: 0,
  isActive: false,
  image: null,
};

const publicSummary: PublicProductSummaryView = {
  id: 'product-1',
  categoryId: 'category-1',
  name: '草莓蛋糕',
  skus: [],
};
const publicDetail: PublicProductDetailView = {
  ...publicSummary,
  detailHtml: '<p>clean</p>',
  images: [],
};
const conflictCode: ApiErrorCode = ApiErrorCode.PRODUCT_STOCK_CONFLICT;
const ownershipCode: ApiErrorCode =
  ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID;

void [
  superAdminLogin,
  operatorLogin,
  SuperAdminLoginDto,
  OperatorLoginDto,
  ExchangeOperatorSessionDto,
  exchangeWithExtraField,
  listedUser,
  listedUserWithRawPhone,
  listSearch,
  loginWithoutKind,
  loginWithMixedIdentityFields,
  incompletePasswordChange,
  incompleteInitialPasswordChange,
  wrongInitialPasswordField,
  grantWithoutConfirmation,
  restrictedOperatorSession,
  fullOperatorSession,
  restrictedSuperAdminSession,
  assertRestrictedSessionNarrowing,
  emptySuperAdminSession,
  partialSuperAdminSession,
  incompleteOperatorSession,
  invalidRestrictedSession,
  upload,
  saveProduct,
  product,
  orderQuery,
  validSupply,
  validSupplyDetail,
  validOrderExport,
  validSupplyExport,
  adminOrderListItem,
  adminOrderSupplyItem,
  adminOrderSupplyDetailItem,
  invalidAdminOrderMissingAmounts,
  invalidSupplyMissingQuantity,
  invalidSupplyDetailMissingLinePayable,
  invalidSupplyStatus,
  missingSupplyStatuses,
  invalidOrderExport,
  invalidSupplyExport,
  productQuery,
  invalidProductQuery,
  banner,
  bannerView,
  legacyBannerView,
  invalidBanner,
  newSku,
  existingSku,
  existingSkuWithoutVersion,
  newSkuWithVersion,
  publicSummary,
  publicDetail,
  conflictCode,
  ownershipCode,
];
