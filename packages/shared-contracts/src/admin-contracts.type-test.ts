import {
  AdminOrderExportView,
  AdminOrderSupplyMatchType,
  ApiErrorCode,
  FulfillmentType,
  BannerTargetType,
  OrderStatus,
  ProductStockFilter,
  type AdminBannerView,
  type AdminOrderExportQuery,
  type AdminOrderListItem,
  type AdminOrderListQuery,
  type AdminOrderSupplyDetailItem,
  type AdminOrderSupplyItem,
  type AdminOrderSupplyDetailQuery,
  type AdminOrderSupplyQuery,
  type AdminProductListQuery,
  type AdminProductDetailView,
  type MediaAsset,
  type PresignUploadResponse,
  type PublicProductDetailView,
  type PublicProductSummaryView,
  type SaveBannerRequest,
  type SaveProductRequest,
  type SaveProductSkuInput,
} from './index.js';

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
