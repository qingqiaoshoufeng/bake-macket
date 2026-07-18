import type { ProductFormShape } from '../type/form.js';

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
