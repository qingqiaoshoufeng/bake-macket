import type {
  AdminProductDetailView,
  AdminProductSummaryView,
  AdminSkuView,
  PublicProductDetailView,
  PublicProductSummaryView,
  SkuView,
} from '@bake-mall/contracts';

import type { AppEnv } from '../config/env.schema.js';
import type { Category } from '../database/entities/category.entity.js';
import type { ProductImage } from '../database/entities/product-image.entity.js';
import type { Product } from '../database/entities/product.entity.js';
import type { Sku } from '../database/entities/sku.entity.js';

const rewritePublicImageUrl = (
  publicUrl: string,
  objectKey: string | null,
  env: AppEnv,
): string => {
  if (env.NODE_ENV === 'production' || !objectKey) return publicUrl;
  if (publicUrl.startsWith('http://127.0.0.1:43900/')) {
    return `/bake-mall/${objectKey}`;
  }
  return publicUrl;
};

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
  skusOrActiveSkuCount: Sku[] | number,
): AdminProductSummaryView {
  const activeSkuCount = Array.isArray(skusOrActiveSkuCount)
    ? skusOrActiveSkuCount.filter(({ isActive }) => isActive).length
    : skusOrActiveSkuCount;
  return {
    ...toAdminProductBaseView(product, category),
    activeSkuCount,
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
  env: AppEnv,
): SkuView {
  return {
    id: sku.id,
    name: sku.name,
    attributes: { ...sku.attributes },
    priceCents: sku.priceCents,
    stock: sku.stock,
    ...(sku.imageUrl
      ? {
          imageUrl: rewritePublicImageUrl(
            sku.imageUrl,
            sku.imageObjectKey,
            env,
          ),
        }
      : {}),
    isAvailable:
      productIsActive && categoryIsActive && sku.isActive && sku.stock > 0,
  };
}

export function toPublicProductSummaryView(
  product: Product,
  category: Category,
  skus: Sku[],
  env: AppEnv,
): PublicProductSummaryView {
  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    ...(product.summary !== null ? { summary: product.summary } : {}),
    ...(product.coverImageUrl
      ? {
          coverImageUrl: rewritePublicImageUrl(
            product.coverImageUrl,
            product.coverImageObjectKey,
            env,
          ),
        }
      : {}),
    skus: skus.map((sku) =>
      toPublicSkuView(sku, product.isActive, category.isActive, env),
    ),
  };
}

export function toPublicProductDetailView(
  product: Product,
  category: Category,
  images: ProductImage[],
  skus: Sku[],
  env: AppEnv,
): PublicProductDetailView {
  return {
    ...toPublicProductSummaryView(product, category, skus, env),
    detailHtml: product.detailHtml,
    images: [...images]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map(({ id, url, objectKey, sortOrder }) => ({
        id,
        url: rewritePublicImageUrl(url, objectKey ?? null, env),
        sortOrder,
      })),
  };
}
