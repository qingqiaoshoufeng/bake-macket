import { BooleanFilter, ProductStockFilter } from '@bake-mall/contracts';

export type ProductFilterForm = {
  q: string;
  categoryId: string;
  isActive: '' | BooleanFilter;
  hasActiveSku: '' | BooleanFilter;
  stock: '' | ProductStockFilter;
  hasCoverImage: '' | BooleanFilter;
  minPriceYuan: string;
  maxPriceYuan: string;
  createdAtRange: readonly [string, string] | null;
};
