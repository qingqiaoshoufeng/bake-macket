import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogFeatureApi } from '../../catalog/api/index.js';
import { catalogMock } from '../../catalog/mock/catalog.mock.js';
import { useHomepageCatalog } from './useHomepageCatalog.js';

vi.mock('../../catalog/api/index.js', () => ({
  catalogFeatureApi: {
    listBanners: vi.fn(),
    listCategories: vi.fn(),
    listProducts: vi.fn(),
  },
}));

const api = vi.mocked(catalogFeatureApi);

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
};

type PendingLanding = Readonly<{
  banners: Deferred<Awaited<ReturnType<typeof api.listBanners>>>;
  categories: Deferred<Awaited<ReturnType<typeof api.listCategories>>>;
  products: Deferred<Awaited<ReturnType<typeof api.listProducts>>>;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function rejectLanding(landing: PendingLanding, message: string): void {
  landing.banners.reject(new Error(`${message} Banner`));
  landing.categories.reject(new Error(`${message} 分类`));
  landing.products.reject(new Error(`${message} 商品`));
}

function pendingLanding(): PendingLanding {
  const banners = deferred<Awaited<ReturnType<typeof api.listBanners>>>();
  const categories = deferred<Awaited<ReturnType<typeof api.listCategories>>>();
  const products = deferred<Awaited<ReturnType<typeof api.listProducts>>>();
  return { banners, categories, products };
}

function usePendingLanding(landing: PendingLanding): void {
  api.listBanners.mockReturnValueOnce(landing.banners.promise);
  api.listCategories.mockReturnValueOnce(landing.categories.promise);
  api.listProducts.mockReturnValueOnce(landing.products.promise);
}

describe('useHomepageCatalog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('keeps the second successful reload when the first request fails later', async () => {
    const first = pendingLanding();
    usePendingLanding(first);
    api.listBanners.mockResolvedValueOnce(catalogMock.banners.slice(0, 1));
    api.listCategories.mockResolvedValueOnce(
      catalogMock.categories.slice(0, 1),
    );
    api.listProducts.mockResolvedValueOnce(catalogMock.products.slice(0, 1));
    const scope = effectScope();
    const catalog = scope.run(useHomepageCatalog)!;

    const firstLoad = catalog.load();
    const secondLoad = catalog.load();
    await secondLoad;

    expect(catalog.banners.value).toEqual(catalogMock.banners.slice(0, 1));
    expect(catalog.categories.value).toEqual(
      catalogMock.categories.slice(0, 1),
    );
    expect(catalog.products.value).toEqual(catalogMock.products.slice(0, 1));
    expect(catalog.errors.value).toEqual({
      banners: null,
      categories: null,
      products: null,
    });
    expect(catalog.loading.value).toBe(false);

    rejectLanding(first, '旧请求失败');
    await firstLoad;

    expect(catalog.banners.value).toEqual(catalogMock.banners.slice(0, 1));
    expect(catalog.categories.value).toEqual(
      catalogMock.categories.slice(0, 1),
    );
    expect(catalog.products.value).toEqual(catalogMock.products.slice(0, 1));
    expect(catalog.errors.value).toEqual({
      banners: null,
      categories: null,
      products: null,
    });
    expect(catalog.loading.value).toBe(false);
    scope.stop();
  });

  it('does not let an older request clear loading while the latest reload is pending', async () => {
    const first = pendingLanding();
    const second = pendingLanding();
    usePendingLanding(first);
    usePendingLanding(second);
    const scope = effectScope();
    const catalog = scope.run(useHomepageCatalog)!;

    const firstLoad = catalog.load();
    const secondLoad = catalog.load();
    rejectLanding(first, '旧请求失败');
    await firstLoad;

    expect(catalog.loading.value).toBe(true);
    expect(catalog.errors.value).toEqual({
      banners: null,
      categories: null,
      products: null,
    });

    second.banners.resolve(catalogMock.banners);
    second.categories.resolve(catalogMock.categories);
    second.products.resolve(catalogMock.products);
    await secondLoad;

    expect(catalog.loading.value).toBe(false);
    scope.stop();
  });

  it('ignores a pending request after its effect scope is disposed', async () => {
    const pending = pendingLanding();
    usePendingLanding(pending);
    const scope = effectScope();
    const catalog = scope.run(useHomepageCatalog)!;
    const load = catalog.load();

    scope.stop();
    const disposedState = {
      banners: catalog.banners.value,
      categories: catalog.categories.value,
      products: catalog.products.value,
      errors: catalog.errors.value,
      loading: catalog.loading.value,
    };
    rejectLanding(pending, '销毁后失败');
    await load;

    expect({
      banners: catalog.banners.value,
      categories: catalog.categories.value,
      products: catalog.products.value,
      errors: catalog.errors.value,
      loading: catalog.loading.value,
    }).toEqual(disposedState);
  });
});
