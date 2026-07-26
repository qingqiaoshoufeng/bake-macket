import { describe, expect, it } from 'vitest';

import type { Category } from '../database/entities/category.entity.js';
import type { ProductImage } from '../database/entities/product-image.entity.js';
import type { Product } from '../database/entities/product.entity.js';
import type { Sku } from '../database/entities/sku.entity.js';
import {
  toAdminProductDetailView,
  toAdminProductSummaryView,
  toPublicProductDetailView,
  toPublicProductSummaryView,
} from './product.mapper.js';

const category = { id: 'category-1', name: '蛋糕', isActive: true } as Category;
const product = {
  id: 'product-1',
  categoryId: 'category-1',
  name: '草莓蛋糕',
  summary: '当日制作',
  coverImageUrl: 'https://cdn.example.com/products/a.webp',
  coverImageObjectKey: 'products/a.webp',
  detailHtml: '<p>clean</p>',
  sortOrder: 2,
  isActive: true,
  createdAt: new Date('2026-07-17T01:00:00.000Z'),
  updatedAt: new Date('2026-07-17T02:00:00.000Z'),
  category,
} as unknown as Product;
const sku = {
  id: 'sku-1',
  productId: 'product-1',
  name: '6寸',
  attributes: { size: '6寸' },
  priceCents: 6800,
  stock: 2,
  stockVersion: 4,
  isActive: true,
  imageUrl: null,
  imageObjectKey: null,
} as unknown as Sku;
const image = {
  id: 'image-1',
  productId: 'product-1',
  url: 'https://cdn.example.com/products/b.webp',
  objectKey: 'products/b.webp',
  sortOrder: 1,
} as unknown as ProductImage;
const earlierImage = {
  id: 'image-2',
  productId: 'product-1',
  url: 'https://cdn.example.com/products/c.webp',
  objectKey: 'products/c.webp',
  sortOrder: 0,
} as unknown as ProductImage;

describe('product mappers', () => {
  it('maps Admin summary/detail including MediaAsset and stockVersion', () => {
    expect(toAdminProductSummaryView(product, category, [sku])).toMatchObject({
      categoryName: '蛋糕',
      activeSkuCount: 1,
      coverImage: {
        objectKey: 'products/a.webp',
        publicUrl: 'https://cdn.example.com/products/a.webp',
      },
      createdAt: '2026-07-17T01:00:00.000Z',
    });
    const images = [image, earlierImage];
    const detail = toAdminProductDetailView(product, category, images, [sku]);

    expect(detail.skus[0]).toMatchObject({ id: 'sku-1', stockVersion: 4 });
    expect(detail.images.map(({ id }) => id)).toEqual(['image-2', 'image-1']);
    expect(images).toEqual([image, earlierImage]);
  });

  it('returns only Public fields and computes availability from all three states', () => {
    const summary = toPublicProductSummaryView(product, category, [sku]);
    const detail = toPublicProductDetailView(product, category, [image], [sku]);
    expect(summary.skus[0].isAvailable).toBe(true);
    expect(detail.images).toEqual([
      { id: 'image-1', url: image.url, sortOrder: 1 },
    ]);
    expect(JSON.stringify(detail)).not.toMatch(
      /coverImageObjectKey|imageObjectKey|"isActive"|"category"/,
    );
    expect(
      toPublicProductSummaryView(product, { ...category, isActive: false }, [
        sku,
      ]).skus[0].isAvailable,
    ).toBe(false);
  });
});
