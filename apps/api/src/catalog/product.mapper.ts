import type {
  AdminProductDetailView,
  AdminProductSummaryView,
  AdminSkuView,
  PublicProductDetailView,
  PublicProductSummaryView,
  SkuView,
} from '@bake-mall/contracts';

import type { Category } from '../database/entities/category.entity.js';
import type { ProductImage } from '../database/entities/product-image.entity.js';
import type { Product } from '../database/entities/product.entity.js';
import type { Sku } from '../database/entities/sku.entity.js';

const toAdminSkuView = (sku: Sku): AdminSkuView => ({
  id: sku.id,
  stockVersion: sku.stockVersion,
  name: sku.name,
  attributes: { ...sku.attributes },
  priceCents: sku.priceCents,
  stock: sku.stock,
  isActive: sku.isActive,
  image:
    sku.imageUrl && sku.imageObjectKey
      ? { objectKey: sku.imageObjectKey, publicUrl: sku.imageUrl }
      : null,
});

function toAdminProductBaseView(product: Product, category: Category) {
  return {
    id: product.id,
    categoryId: product.categoryId,
    categoryName: category.name,
    name: product.name,
    ...(product.summary !== null ? { summary: product.summary } : {}),
    coverImage:
      product.coverImageUrl && product.coverImageObjectKey
        ? {
            objectKey: product.coverImageObjectKey,
            publicUrl: product.coverImageUrl,
          }
        : null,
    sortOrder: product.sortOrder,
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function toAdminProductSummaryView(
  product: Product,
  category: Category,
  skus: Sku[],
): AdminProductSummaryView {
  return {
    ...toAdminProductBaseView(product, category),
    activeSkuCount: skus.filter(({ isActive }) => isActive).length,
  };
}

export function toAdminProductDetailView(
  product: Product,
  category: Category,
  images: ProductImage[],
  skus: Sku[],
): AdminProductDetailView {
  return {
    ...toAdminProductBaseView(product, category),
    detailHtml: product.detailHtml,
    images: [...images]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .filter(({ objectKey }) => Boolean(objectKey))
      .map((image) => ({
        id: image.id,
        objectKey: image.objectKey as string,
        publicUrl: image.url,
        sortOrder: image.sortOrder,
      })),
    skus: skus.map(toAdminSkuView),
  };
}

export function toPublicSkuView(
  sku: Sku,
  productIsActive: boolean,
  categoryIsActive: boolean,
): SkuView {
  return {
    id: sku.id,
    name: sku.name,
    attributes: { ...sku.attributes },
    priceCents: sku.priceCents,
    stock: sku.stock,
    ...(sku.imageUrl ? { imageUrl: sku.imageUrl } : {}),
    isAvailable:
      productIsActive && categoryIsActive && sku.isActive && sku.stock > 0,
  };
}

export function toPublicProductSummaryView(
  product: Product,
  category: Category,
  skus: Sku[],
): PublicProductSummaryView {
  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    ...(product.summary !== null ? { summary: product.summary } : {}),
    ...(product.coverImageUrl ? { coverImageUrl: product.coverImageUrl } : {}),
    skus: skus.map((sku) =>
      toPublicSkuView(sku, product.isActive, category.isActive),
    ),
  };
}

export function toPublicProductDetailView(
  product: Product,
  category: Category,
  images: ProductImage[],
  skus: Sku[],
): PublicProductDetailView {
  return {
    ...toPublicProductSummaryView(product, category, skus),
    detailHtml: product.detailHtml,
    images: [...images]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map(({ id, url, sortOrder }) => ({ id, url, sortOrder })),
  };
}
