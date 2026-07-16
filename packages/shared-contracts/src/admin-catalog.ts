import type { MediaAsset } from './media.js';

export type AdminCategoryView = {
  id: string;
  name: string;
  imageUrl?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
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

export type AdminSkuView = {
  id: string;
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

export type SaveProductSkuInput = {
  id?: string;
  name: string;
  attributes: Record<string, string>;
  priceCents: number;
  stock: number;
  isActive: boolean;
  image: MediaAsset | null;
};

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
