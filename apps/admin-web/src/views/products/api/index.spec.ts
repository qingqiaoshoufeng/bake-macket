import type { SaveProductRequest } from '@bake-mall/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../../api/http.js';
import { productsApi } from './index.js';

vi.mock('../../../api/http.js', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const client = vi.mocked(apiClient);

const body: SaveProductRequest = {
  name: '草莓蛋糕',
  summary: '当季草莓',
  categoryId: 'category-1',
  detailHtml: '<p>草莓蛋糕</p>',
  coverImage: {
    objectKey: 'products/cover.webp',
    publicUrl: 'https://cdn.example.com/products/cover.webp',
  },
  images: [],
  skus: [
    {
      name: '六寸',
      attributes: { size: '六寸' },
      priceCents: 12800,
      stock: 10,
      isActive: true,
      image: null,
    },
  ],
  deletedSkuIds: [],
  sortOrder: 0,
  isActive: true,
};

describe('productsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('composes the five admin product endpoints without reshaping the body', async () => {
    await productsApi.list();
    await productsApi.getOne('product-1');
    await productsApi.create(body);
    await productsApi.replace('product-1', body);
    await productsApi.remove('product-1');

    expect(client.get).toHaveBeenNthCalledWith(1, '/admin/products');
    expect(client.get).toHaveBeenNthCalledWith(2, '/admin/products/product-1');
    expect(client.post).toHaveBeenCalledWith('/admin/products', body);
    expect(client.put).toHaveBeenCalledWith('/admin/products/product-1', body);
    expect(client.delete).toHaveBeenCalledWith('/admin/products/product-1');
  });
});
