import type {
  BannerView,
  CategoryView,
  PublicProductDetailView,
  PublicProductSummaryView,
} from '@bake-mall/contracts';

export type CatalogBanner = BannerView;
export type CatalogCategory = CategoryView;
export type CatalogProduct = PublicProductSummaryView;
export type CatalogProductDetail = PublicProductDetailView;

export type CatalogFilter = {
  readonly categoryId?: string;
  readonly q?: string;
};
