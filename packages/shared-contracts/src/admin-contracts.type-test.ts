import {
  ApiErrorCode,
  BannerTargetType,
  type AdminBannerView,
  type AdminOrderListQuery,
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
