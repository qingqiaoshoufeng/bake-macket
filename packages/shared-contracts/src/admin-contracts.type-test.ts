import {
  BannerTargetType,
  type AdminBannerView,
  type AdminOrderListQuery,
  type AdminProductDetailView,
  type MediaAsset,
  type PresignUploadResponse,
  type SaveBannerRequest,
  type SaveProductRequest,
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

// @ts-expect-error NONE banners forbid targetId.
const invalidBanner: SaveBannerRequest = {
  image,
  targetType: BannerTargetType.NONE,
  targetId: 'product-1',
  sortOrder: 0,
  isActive: true,
};

void [upload, saveProduct, product, orderQuery, banner, bannerView, invalidBanner];
