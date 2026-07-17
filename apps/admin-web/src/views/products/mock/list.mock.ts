import type { AdminProductSummaryView } from '@bake-mall/contracts';

export const PRODUCT_LIST_MOCK: readonly AdminProductSummaryView[] = [
  {
    id: 'product-1',
    categoryId: 'category-cake',
    categoryName: '蛋糕',
    name: '草莓奶油蛋糕',
    summary: '当日现制草莓奶油蛋糕',
    coverImage: {
      objectKey: 'products/strawberry-cream-cake.webp',
      publicUrl: 'https://cdn.example.com/products/strawberry-cream-cake.webp',
    },
    sortOrder: 10,
    isActive: true,
    activeSkuCount: 2,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  },
  {
    id: 'product-2',
    categoryId: 'category-bread',
    categoryName: '面包',
    name: '海盐可颂',
    coverImage: {
      objectKey: 'products/sea-salt-croissant.webp',
      publicUrl: 'https://cdn.example.com/products/sea-salt-croissant.webp',
    },
    sortOrder: 20,
    isActive: false,
    activeSkuCount: 0,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  },
];
