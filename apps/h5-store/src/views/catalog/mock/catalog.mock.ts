import { BannerTargetType } from '@bake-mall/contracts';

import type {
  CatalogBanner,
  CatalogCategory,
  CatalogProduct,
} from '../type/index.js';

const banners: CatalogBanner[] = [
  {
    id: 'banner-summer',
    imageUrl: 'https://cdn.example.com/banners/summer.webp',
    title: '今日现烤 · 松软出炉',
    targetType: BannerTargetType.CATEGORY,
    targetId: 'bread',
  },
];

const categories: CatalogCategory[] = [
  { id: 'cake', name: '生日蛋糕' },
  { id: 'bread', name: '现烤面包' },
  { id: 'tea', name: '下午茶' },
];

const products: CatalogProduct[] = [
  {
    id: 'product-strawberry',
    categoryId: 'cake',
    name: '草莓云朵蛋糕',
    summary: '当日草莓与轻盈奶油',
    coverImageUrl: 'https://cdn.example.com/products/strawberry.webp',
    detailHtml: '<p>轻盈奶油搭配当日草莓。</p>',
  },
  {
    id: 'product-croissant',
    categoryId: 'bread',
    name: '黄油可颂',
    summary: '层层酥香，建议当日享用',
    detailHtml: '<p>法国黄油与长时间低温发酵。</p>',
  },
];

export const catalogMock = { banners, categories, products } as const;
