import type {
  BannerView,
  CategoryView,
  ProductView,
} from '@bake-mall/contracts';

import type { ProductListItem } from '../../../api/catalog.js';

export type CatalogBanner = BannerView;
export type CatalogCategory = CategoryView;
export type CatalogProduct = ProductListItem;
export type CatalogProductDetail = ProductView;

export type CatalogFilter = {
  readonly categoryId?: string;
  readonly q?: string;
};
