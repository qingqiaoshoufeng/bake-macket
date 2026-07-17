import type { AdminProductSummaryView } from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { productsApi } from '../api/index.js';
import { useProductsList } from './useProductsList.js';

vi.mock('../api/index.js', () => ({
  productsApi: {
    list: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(productsApi);

const product: AdminProductSummaryView = {
  id: 'product-1',
  categoryId: 'category-1',
  categoryName: '蛋糕',
  name: '草莓奶油蛋糕',
  coverImage: {
    objectKey: 'products/strawberry.webp',
    publicUrl: 'https://cdn.example.com/products/strawberry.webp',
  },
  sortOrder: 10,
  isActive: true,
  activeSkuCount: 2,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

describe('useProductsList', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('loads products into a new array', async () => {
    api.list.mockResolvedValueOnce([product]);
    const { products, loading, lastError, refresh } = useProductsList();

    await refresh();

    expect(products.value).toEqual([product]);
    expect(products.value).not.toBe(product);
    expect(loading.value).toBe(false);
    expect(lastError.value).toBeNull();
  });

  it('retains products after refresh failure and clears the error on retry', async () => {
    api.list
      .mockResolvedValueOnce([product])
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce([]);
    const { products, lastError, refresh } = useProductsList();

    await refresh();
    await refresh();

    expect(products.value).toEqual([product]);
    expect(lastError.value).toBe('商品加载失败，请重试');

    await refresh();

    expect(products.value).toEqual([]);
    expect(lastError.value).toBeNull();
  });

  it('refreshes only after successful deletion and preserves rows on failure', async () => {
    api.list.mockResolvedValueOnce([product]).mockResolvedValueOnce([]);
    api.remove.mockResolvedValueOnce(undefined);
    const success = useProductsList();

    await success.refresh();
    await success.remove(product.id);

    expect(api.remove).toHaveBeenCalledWith(product.id);
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(success.products.value).toEqual([]);

    api.list.mockResolvedValueOnce([product]);
    api.remove.mockRejectedValueOnce(new Error('删除失败'));
    const failure = useProductsList();
    await failure.refresh();

    await expect(failure.remove(product.id)).rejects.toThrow('删除失败');
    expect(failure.products.value).toEqual([product]);
  });
});
