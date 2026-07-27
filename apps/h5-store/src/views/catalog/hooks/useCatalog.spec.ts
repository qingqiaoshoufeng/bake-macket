import type { PublicProductDetailView } from '@bake-mall/contracts';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

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

  it('stores the public product detail returned by the detail endpoint', async () => {
    const detail: PublicProductDetailView = {
      id: 'product-1',
      categoryId: 'cake',
      name: '草莓云朵蛋糕',
      detailHtml: '<p>服务端清洗后的商品详情</p>',
      images: [],
      skus: [
        {
          id: 'sku-live',
          name: '6寸',
          attributes: {},
          priceCents: 6800,
          stock: 3,
          isAvailable: true,
        },
      ],
    };
    api.getProduct.mockResolvedValue(detail);
    const catalog = useCatalog();

    const loaded = await catalog.loadProduct(detail.id);

    expect(api.getProduct).toHaveBeenCalledWith(detail.id);
    expect(loaded).toBe(detail);
    expect(catalog.product.value).toBe(detail);
  });

  it('clears stale product and keeps the latest detail when requests settle out of order', async () => {
    const productA = deferred<PublicProductDetailView>();
    const detailB = {
      id: 'product-b',
      categoryId: 'cake',
      name: 'B 商品',
      detailHtml: '<p>B</p>',
      images: [],
      skus: [],
    } satisfies PublicProductDetailView;
    api.getProduct
      .mockReturnValueOnce(productA.promise)
      .mockResolvedValueOnce(detailB);
    const catalog = useCatalog();

    const loadA = catalog.loadProduct('product-a');
    const loadB = catalog.loadProduct('product-b');
    expect(catalog.product.value).toBeNull();
    await loadB;
    expect(catalog.product.value).toBe(detailB);
    expect(catalog.loading.value).toBe(false);

    productA.resolve({ ...detailB, id: 'product-a', name: 'A 商品' });
    await loadA;
    expect(catalog.product.value).toBe(detailB);
  });

  it('surfaces home loading failures without keeping stale loading state', async () => {
    api.listProducts.mockRejectedValueOnce(new Error('商品加载失败'));
    const catalog = useCatalog();

    await expect(catalog.loadHome()).rejects.toThrow('商品加载失败');
    expect(catalog.loading.value).toBe(false);
    expect(catalog.lastError.value).toBe('商品加载失败');
  });
});
