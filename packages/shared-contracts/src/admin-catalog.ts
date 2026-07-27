import type { AdminBannerView } from './admin-banner.js';
import type { BannerTargetType } from './enums.js';
import type {
  AdminPageQuery,
  BooleanFilter,
  CreatedAtRangeQuery,
  PaginatedView,
  ProductStockFilter,
} from './admin-list.js';
import type { MediaAsset } from './media.js';

export type AdminCategoryListQuery = AdminPageQuery &
  CreatedAtRangeQuery & {
    q?: string;
    isActive?: BooleanFilter;
    hasImage?: BooleanFilter;
    hasProducts?: BooleanFilter;
  };

export type AdminCategoryView = {
  id: string;
  name: string;
  imageUrl?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminCategoryListResult = PaginatedView<AdminCategoryView>;

export type AdminProductListQuery = AdminPageQuery &
  CreatedAtRangeQuery & {
    q?: string;
    categoryId?: string;
    isActive?: BooleanFilter;
    hasActiveSku?: BooleanFilter;
    stock?: ProductStockFilter;
    lowStockThreshold?: number;
    hasCoverImage?: BooleanFilter;
    minPriceCents?: number;
    maxPriceCents?: number;
  };

export type AdminProductSummaryView = {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  summary?: string;
  coverImage: MediaAsset | null;
  sortOrder: number;
  isActive: boolean;
  activeSkuCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminProductListResult = PaginatedView<AdminProductSummaryView>;

export type AdminBannerListQuery = AdminPageQuery &
  CreatedAtRangeQuery & {
    q?: string;
    isActive?: BooleanFilter;
    targetType?: BannerTargetType;
    targetId?: string;
    targetValid?: BooleanFilter;
  };

export type AdminBannerListResult = PaginatedView<AdminBannerView>;

export type AdminSkuView = {
  id: string;
  stockVersion: number;
  name: string;
  attributes: Record<string, string>;
  priceCents: number;
  stock: number;
  isActive: boolean;
  image: MediaAsset | null;
};

export type AdminProductImageView = MediaAsset & {
  id: string;
  sortOrder: number;
};

export type AdminProductDetailView = Omit<
  AdminProductSummaryView,
  'activeSkuCount'
> & {
  detailHtml: string;
  images: AdminProductImageView[];
  skus: AdminSkuView[];
};

export type SaveProductImageInput = MediaAsset & {
  id?: string;
  sortOrder: number;
};

type SaveProductSkuFields = {
  name: string;
  attributes: Record<string, string>;
  priceCents: number;
  stock: number;
  isActive: boolean;
  image: MediaAsset | null;
};

export type SaveProductSkuInput = SaveProductSkuFields &
  ({ id?: never; stockVersion?: never } | { id: string; stockVersion: number });

export type SaveProductRequest = {
  name: string;
  summary?: string;
  categoryId: string;
  detailHtml: string;
  coverImage: MediaAsset | null;
  images: SaveProductImageInput[];
  skus: SaveProductSkuInput[];
  deletedSkuIds: string[];
  sortOrder: number;
  isActive: boolean;
};
