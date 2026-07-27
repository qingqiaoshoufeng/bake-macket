import type { AdminProductDetailView } from '@bake-mall/contracts';

export const PRODUCT_DETAIL_MOCK: AdminProductDetailView = {
  id: 'product-1',
  categoryId: 'category-1',
  categoryName: '蛋糕',
  name: '草莓奶油蛋糕',
  summary: '新鲜草莓与动物奶油',
  coverImage: {
    objectKey: 'products/strawberry-cover.webp',
    publicUrl: 'https://cdn.example.com/products/strawberry-cover.webp',
  },
  detailHtml: '<p>服务端已清理的商品详情</p>',
  images: [
    {
      id: 'product-image-1',
      objectKey: 'products/strawberry-1.webp',
      publicUrl: 'https://cdn.example.com/products/strawberry-1.webp',
      sortOrder: 0,
    },
  ],
  skus: [
    {
      id: 'sku-1',
      stockVersion: 4,
      name: '6寸',
      attributes: { 尺寸: '6寸', 口味: '草莓' },
      priceCents: 6850,
      stock: 0,
      isActive: true,
      image: {
        objectKey: 'products/strawberry-sku.webp',
        publicUrl: 'https://cdn.example.com/products/strawberry-sku.webp',
      },
    },
  ],
  sortOrder: 0,
  isActive: true,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};
