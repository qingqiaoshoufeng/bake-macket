import { beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogFeatureApi } from '../api/index.js';
import { catalogMock } from '../mock/catalog.mock.js';
import { useCatalog } from './useCatalog.js';

vi.mock('../api/index.js', () => ({
  catalogFeatureApi: {
    listBanners: vi.fn(),
    listCategories: vi.fn(),
    listProducts: vi.fn(),
    getProduct: vi.fn(),
  },
}));

const api = vi.mocked(catalogFeatureApi);

describe('useCatalog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listBanners.mockResolvedValue(catalogMock.banners);
    api.listCategories.mockResolvedValue(catalogMock.categories);
    api.listProducts.mockResolvedValue(catalogMock.products);
  });

  it('loads banners, categories, and products together', async () => {
    const catalog = useCatalog();

    await catalog.loadHome();

    expect(catalog.loading.value).toBe(false);
    expect(catalog.banners.value).toEqual(catalogMock.banners);
    expect(catalog.categories.value).toEqual(catalogMock.categories);
    expect(catalog.products.value).toEqual(catalogMock.products);
  });

  it('passes category and trimmed search filters to the API', async () => {
    const catalog = useCatalog();

    await catalog.loadProducts({ categoryId: 'cake', q: '  草莓  ' });

    expect(api.listProducts).toHaveBeenCalledWith({
      categoryId: 'cake',
      q: '草莓',
    });
  });

  it('surfaces home loading failures without keeping stale loading state', async () => {
    api.listProducts.mockRejectedValueOnce(new Error('商品加载失败'));
    const catalog = useCatalog();

    await expect(catalog.loadHome()).rejects.toThrow('商品加载失败');
    expect(catalog.loading.value).toBe(false);
    expect(catalog.lastError.value).toBe('商品加载失败');
  });
});
