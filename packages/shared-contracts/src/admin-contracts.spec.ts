import { describe, expect, it } from 'vitest';

import {
  AdminOrderExportView,
  AdminOrderSupplyMatchType,
  ApiErrorCode,
  BannerTargetType,
  FulfillmentType,
  OrderStatus,
  SUPPLY_ORDER_STATUSES,
  type AdminBannerView,
  type AdminOrderExportQuery,
  type AdminOrderListItem,
  type AdminOrderListQuery,
  type AdminOrderListResult,
  type AdminOrderSupplyDetailResult,
  type AdminOrderSupplyResult,
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

  it('defines the exact supply status subset and export error code', () => {
    expect(SUPPLY_ORDER_STATUSES).toEqual([
      OrderStatus.NEW,
      OrderStatus.PROCESSING,
    ]);
    expect(AdminOrderExportView).toEqual({ ORDER: 'ORDER', SUPPLY: 'SUPPLY' });
    expect(AdminOrderSupplyMatchType).toEqual({
      SKU_ID: 'SKU_ID',
      LEGACY_FALLBACK: 'LEGACY_FALLBACK',
    });
    expect(ApiErrorCode.EXPORT_TOO_LARGE).toBe('EXPORT_TOO_LARGE');
    expect(ApiErrorCode.EXPORT_IN_PROGRESS).toBe('EXPORT_IN_PROGRESS');
  });

  it('models complete order rows, supply pages and discriminated exports', () => {
    const orderItem: AdminOrderListItem = {
      id: 'order-1',
      orderNo: 'BM202607280001',
      userId: 'user-1',
      status: OrderStatus.NEW,
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '张三',
      contactPhone: '13800000000',
      itemLineCount: 1,
      totalQuantity: 2,
      goodsTotalCents: 13_600,
      membershipDiscountCents: 1_360,
      creditAppliedCents: 500,
      payableTotalCents: 11_740,
      pickupTimeText: '明天 10:00',
      membershipCode: 'GOLD',
      membershipName: '鎏金会员',
      membershipDiscountBasisPoints: 9_000,
      remark: '少糖',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    };
    const supply: AdminOrderSupplyResult = {
      items: [
        {
          groupKey: 'sku:1',
          matchType: AdminOrderSupplyMatchType.SKU_ID,
          productId: '1',
          skuId: '1',
          productName: '草莓蛋糕',
          skuName: '6寸',
          skuAttributes: { size: '6寸' },
          requiredQuantity: 2,
          orderCount: 1,
          newQuantity: 2,
          processingQuantity: 0,
          remainingSaleableStock: 3,
          earliestOrderCreatedAt: orderItem.createdAt,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    const details: AdminOrderSupplyDetailResult = {
      items: [
        {
          orderItemId: 'item-1',
          orderId: orderItem.id,
          orderNo: orderItem.orderNo,
          status: OrderStatus.NEW,
          fulfillmentType: FulfillmentType.PICKUP,
          contactName: orderItem.contactName,
          contactPhone: orderItem.contactPhone,
          pickupTimeText: orderItem.pickupTimeText,
          productId: '1',
          skuId: '1',
          productName: '草莓蛋糕',
          skuName: '6寸',
          skuAttributes: { size: '6寸' },
          quantity: 2,
          unitPriceCents: 6_800,
          lineGoodsTotalCents: 13_600,
          lineMembershipDiscountCents: 1_360,
          linePayableCents: 12_240,
          remark: orderItem.remark,
          orderCreatedAt: orderItem.createdAt,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    };
    const exportQuery: AdminOrderExportQuery = {
      view: AdminOrderExportView.SUPPLY,
      supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
    };

    expect(supply.items[0]?.requiredQuantity).toBe(2);
    expect(details.items[0]?.linePayableCents).toBe(12_240);
    expect(exportQuery.view).toBe(AdminOrderExportView.SUPPLY);
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
    const update = {
      order: null,
      noRestock: true,
    } as unknown as OrderStatusUpdateResult;
    expect(result.total).toBe(0);
    expect(update.noRestock).toBe(true);
  });
});
