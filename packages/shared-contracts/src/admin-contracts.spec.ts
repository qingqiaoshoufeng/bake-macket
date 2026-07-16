import { describe, expect, it } from 'vitest';

import {
  BannerTargetType,
  FulfillmentType,
  OrderStatus,
  type AdminBannerView,
  type AdminOrderListQuery,
  type AdminOrderListResult,
  type AdminProductDetailView,
  type MediaAsset,
  type OrderStatusUpdateResult,
  type PresignUploadResponse,
  type SaveBannerRequest,
  type SaveProductRequest,
} from './index.js';

const image: MediaAsset = {
  objectKey: 'products/cake.webp',
  publicUrl: 'https://cdn.example.com/products/cake.webp',
};

const product: AdminProductDetailView = {
  id: 'product-1',
  name: '草莓蛋糕',
  categoryId: 'category-1',
  categoryName: '生日蛋糕',
  summary: '当日草莓',
  detailHtml: '<p>已清洗</p>',
  coverImage: image,
  images: [{ id: 'image-1', ...image, sortOrder: 0 }],
  skus: [
    {
      id: 'sku-1',
      name: '6寸',
      attributes: { size: '6寸' },
      priceCents: 6800,
      stock: 3,
      isActive: true,
      image: null,
    },
  ],
  sortOrder: 0,
  isActive: true,
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
};

describe('Task 12 admin contracts', () => {
  it('keeps upload destinations separate from public media URLs', () => {
    const response: PresignUploadResponse = {
      objectKey: image.objectKey,
      publicUrl: image.publicUrl,
      uploadUrl: 'http://127.0.0.1:9000/bake-mall',
      fields: { key: image.objectKey },
      expiresAt: '2026-07-16T00:05:00.000Z',
    };
    expect(response.publicUrl).not.toBe(response.uploadUrl);
  });

  it('models aggregate product saves and complete admin detail', () => {
    const request: SaveProductRequest = {
      name: product.name,
      categoryId: product.categoryId,
      detailHtml: product.detailHtml,
      coverImage: image,
      images: product.images,
      skus: product.skus,
      deletedSkuIds: [],
      sortOrder: 0,
      isActive: true,
    };
    expect(request.skus[0].priceCents).toBe(6800);
    expect(product.images[0].objectKey).toBe(image.objectKey);
  });

  it('models discriminated Banner targets', () => {
    const request: SaveBannerRequest = {
      image,
      targetType: BannerTargetType.PRODUCT,
      targetId: product.id,
      sortOrder: 0,
      isActive: true,
    };
    const view: AdminBannerView = {
      id: 'banner-1',
      ...request,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    };
    expect(view.targetId).toBe(product.id);
  });

  it('models paginated order filters and status update envelopes', () => {
    const query: AdminOrderListQuery = {
      orderNo: 'BM2026',
      status: OrderStatus.NEW,
      fulfillmentType: FulfillmentType.PICKUP,
      createdAtFrom: '2026-07-01T00:00:00.000Z',
      createdAtBefore: '2026-08-01T00:00:00.000Z',
      page: 1,
      pageSize: 20,
    };
    const result: AdminOrderListResult = {
      items: [],
      page: query.page,
      pageSize: query.pageSize,
      total: 0,
    };
    const update = { order: null, noRestock: true } as unknown as OrderStatusUpdateResult;
    expect(result.total).toBe(0);
    expect(update.noRestock).toBe(true);
  });
});
