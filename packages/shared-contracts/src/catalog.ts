import { BannerTargetType } from './enums.js';

export type CategoryView = {
  id: string;
  name: string;
  imageUrl?: string;
};

export type SkuView = {
  id: string;
  name: string;
  attributes: Record<string, string>;
  priceCents: number;
  stock: number;
  imageUrl?: string;
  isAvailable: boolean;
};

export type ProductImageView = {
  id: string;
  url: string;
  sortOrder: number;
};

export type PublicProductSummaryView = {
  id: string;
  categoryId: string;
  name: string;
  summary?: string;
  coverImageUrl?: string;
  skus: SkuView[];
};

export type PublicProductDetailView = PublicProductSummaryView & {
  detailHtml: string;
  images: ProductImageView[];
};

/** 兼容现有详情消费者；新边界应使用明确的 Summary/Detail 名称。 */
export type ProductView = PublicProductDetailView;

type BannerBase = {
  id: string;
  imageUrl: string;
  title?: string;
};

export type BannerView = BannerBase &
  (
    | {
        targetType: BannerTargetType.NONE;
        targetId?: never;
      }
    | {
        targetType: BannerTargetType.PRODUCT;
        targetId: string;
      }
    | {
        targetType: BannerTargetType.CATEGORY;
        targetId: string;
      }
  );

// Type-level assertions: invalid variants must fail typecheck.
const _bannerNone: BannerView = {
  id: 'banner-1',
  imageUrl: 'https://cdn.example.com/banner-1.jpg',
  targetType: BannerTargetType.NONE,
};

const _bannerProduct: BannerView = {
  id: 'banner-2',
  imageUrl: 'https://cdn.example.com/banner-2.jpg',
  title: 'Featured cake',
  targetType: BannerTargetType.PRODUCT,
  targetId: 'product-1',
};

const _bannerCategory: BannerView = {
  id: 'banner-3',
  imageUrl: 'https://cdn.example.com/banner-3.jpg',
  targetType: BannerTargetType.CATEGORY,
  targetId: 'category-1',
};

// @ts-expect-error NONE forbids targetId.
const _bannerNoneWithTarget: BannerView = {
  id: 'banner-4',
  imageUrl: 'https://cdn.example.com/banner-4.jpg',
  targetType: BannerTargetType.NONE,
  targetId: 'product-1',
};

// @ts-expect-error PRODUCT requires targetId.
const _bannerProductMissingTarget: BannerView = {
  id: 'banner-5',
  imageUrl: 'https://cdn.example.com/banner-5.jpg',
  targetType: BannerTargetType.PRODUCT,
};

// @ts-expect-error CATEGORY requires targetId.
const _bannerCategoryMissingTarget: BannerView = {
  id: 'banner-6',
  imageUrl: 'https://cdn.example.com/banner-6.jpg',
  targetType: BannerTargetType.CATEGORY,
};

void [
  _bannerNone,
  _bannerProduct,
  _bannerCategory,
  _bannerNoneWithTarget,
  _bannerProductMissingTarget,
  _bannerCategoryMissingTarget,
];
