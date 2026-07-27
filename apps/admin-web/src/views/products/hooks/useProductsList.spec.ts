import {
  BooleanFilter,
  ProductStockFilter,
  type AdminCategoryListResult,
  type AdminProductListResult,
  type AdminProductSummaryView,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { categoriesApi } from '../../categories/api/index.js';
import { productsApi } from '../api/index.js';
import { toProductListQuery, useProductsList } from './useProductsList.js';

vi.mock('../../categories/api/index.js', () => ({
  categoriesApi: { list: vi.fn() },
}));
vi.mock('../api/index.js', () => ({
  productsApi: {
    list: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(productsApi);
const categoryApi = vi.mocked(categoriesApi);

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

const productResult = (
  items: AdminProductSummaryView[] = [product],
  page = 1,
  pageSize = 20,
): AdminProductListResult => ({ items, total: items.length, page, pageSize });

const categoryResult: AdminCategoryListResult = {
  items: [
    {
      id: 'category-1',
      name: '蛋糕',
      sortOrder: 0,
      isActive: true,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 100,
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  const resolve = vi.fn<(value: T) => void>();
  const promise = new Promise<T>((promiseResolve) => {
    resolve.mockImplementation(promiseResolve);
  });
  return { promise, resolve };
}

describe('useProductsList', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('converts trimmed filters and exact yuan text to an integer-cent query', () => {
    expect(
      toProductListQuery(
        {
          q: '  草莓  ',
          categoryId: 'category-1',
          isActive: BooleanFilter.YES,
          hasActiveSku: BooleanFilter.NO,
          stock: ProductStockFilter.LOW_STOCK,
          hasCoverImage: BooleanFilter.YES,
          minPriceYuan: '0.29',
          maxPriceYuan: '68.50',
          createdAtRange: [
            '2026-07-01T00:00:00.000Z',
            '2026-08-01T00:00:00.000Z',
          ],
        },
        3,
        50,
      ),
    ).toEqual({
      q: '草莓',
      categoryId: 'category-1',
      isActive: BooleanFilter.YES,
      hasActiveSku: BooleanFilter.NO,
      stock: ProductStockFilter.LOW_STOCK,
      lowStockThreshold: 10,
      hasCoverImage: BooleanFilter.YES,
      minPriceCents: 29,
      maxPriceCents: 6850,
      createdAtFrom: '2026-07-01T00:00:00.000Z',
      createdAtBefore: '2026-08-01T00:00:00.000Z',
      page: 3,
      pageSize: 50,
    });
  });

  it('loads every category option page and reports option failures without hiding product rows', async () => {
    const secondCategory = { ...categoryResult.items[0], id: 'category-101' };
    categoryApi.list
      .mockResolvedValueOnce({ ...categoryResult, total: 101 })
      .mockResolvedValueOnce({
        items: [secondCategory],
        total: 101,
        page: 2,
        pageSize: 100,
      });
    api.list.mockResolvedValueOnce(productResult());
    const success = useProductsList();

    await success.initialize();

    expect(categoryApi.list).toHaveBeenNthCalledWith(2, {
      page: 2,
      pageSize: 100,
    });
    expect(success.categories.value).toEqual([
      ...categoryResult.items,
      secondCategory,
    ]);

    categoryApi.list.mockReset().mockRejectedValueOnce(new Error('分类失败'));
    api.list.mockResolvedValueOnce(productResult());
    const failure = useProductsList();
    await failure.initialize();

    expect(failure.products.value).toEqual([product]);
    expect(failure.lastError.value).toBe('分类选项加载失败，请重试');
  });

  it('rejects invalid price text before applying filters or requesting', async () => {
    api.list.mockResolvedValue(productResult());
    const state = useProductsList();
    state.draftFilters.minPriceYuan = '0.291';

    await expect(state.search()).rejects.toThrow('金额最多保留两位小数');

    expect(api.list).not.toHaveBeenCalled();
    expect(state.hasAppliedFilters.value).toBe(false);
    expect(state.page.value).toBe(1);
  });

  it('keeps draft filters separate until search and resets page for search, reset, and page-size changes', async () => {
    api.list.mockImplementation((query) =>
      Promise.resolve(productResult([product], query.page, query.pageSize)),
    );
    categoryApi.list.mockResolvedValue(categoryResult);
    const state = useProductsList();

    await state.initialize();
    state.draftFilters.q = '草莓';
    await state.setPage(4);

    expect(api.list).toHaveBeenLastCalledWith({ page: 4, pageSize: 20 });

    await state.search();
    expect(api.list).toHaveBeenLastCalledWith({
      q: '草莓',
      page: 1,
      pageSize: 20,
    });

    await state.setPageSize(50);
    expect(api.list).toHaveBeenLastCalledWith({
      q: '草莓',
      page: 1,
      pageSize: 50,
    });

    await state.reset();
    expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 });
    expect(state.draftFilters.q).toBe('');
  });

  it('counts only applied advanced filters', async () => {
    api.list.mockResolvedValue(productResult());
    categoryApi.list.mockResolvedValue(categoryResult);
    const state = useProductsList();

    state.draftFilters.stock = ProductStockFilter.OUT_OF_STOCK;
    expect(state.advancedCount.value).toBe(0);

    await state.search();
    expect(state.advancedCount.value).toBe(1);
    expect(state.hasAppliedFilters.value).toBe(true);
  });

  it('ignores stale list responses and retains current rows after failure', async () => {
    const stale = createDeferred<AdminProductListResult>();
    const current = createDeferred<AdminProductListResult>();
    api.list
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const state = useProductsList();

    const firstLoad = state.refresh();
    const secondLoad = state.refresh();
    current.resolve(productResult([product], 2));
    await secondLoad;
    stale.resolve(productResult([], 1));
    await firstLoad;

    expect(state.products.value).toEqual([product]);
    expect(state.page.value).toBe(2);

    api.list.mockRejectedValueOnce(new Error('网络不可用'));
    await state.refresh();
    expect(state.products.value).toEqual([product]);
    expect(state.lastError.value).toBe('商品加载失败，请重试');
  });

  it('refreshes only after successful deletion and preserves rows on failure', async () => {
    api.list
      .mockResolvedValueOnce(productResult())
      .mockResolvedValueOnce(productResult([]));
    api.remove.mockResolvedValueOnce(undefined);
    const success = useProductsList();

    await success.refresh();
    await success.remove(product.id);

    expect(api.remove).toHaveBeenCalledWith(product.id);
    expect(success.products.value).toEqual([]);

    api.list.mockResolvedValueOnce(productResult());
    api.remove.mockRejectedValueOnce(new Error('删除失败'));
    const failure = useProductsList();
    await failure.refresh();

    await expect(failure.remove(product.id)).rejects.toThrow('删除失败');
    expect(failure.products.value).toEqual([product]);
  });
});
