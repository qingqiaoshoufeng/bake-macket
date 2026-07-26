import type { ProductFormShape } from '../type/form.js';
import type { ProductFilterForm } from '../type/list.js';

export const createProductFilterDefaults = (): ProductFilterForm => ({
  q: '',
  categoryId: '',
  isActive: '',
  hasActiveSku: '',
  stock: '',
  hasCoverImage: '',
  minPriceYuan: '',
  maxPriceYuan: '',
  createdAtRange: null,
});

export function createDefaultProductForm(): ProductFormShape {
  return {
    name: '',
    summary: '',
    categoryId: '',
    coverImage: null,
    images: [],
    detailHtml: '',
    skus: [],
    sortOrder: 0,
    isActive: false,
  };
}
