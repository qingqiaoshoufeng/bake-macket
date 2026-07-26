import {
  BannerTargetType,
  BooleanFilter,
  type AdminBannerListResult,
  type AdminBannerView,
  type AdminCategoryListResult,
  type AdminCategoryView,
  type AdminProductListResult,
  type AdminProductSummaryView,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { categoriesApi } from '../../categories/api/index.js';
import { productsApi } from '../../products/api/index.js';
import { bannersApi } from '../api/index.js';
import { useBanners } from './useBanners.js';

vi.mock('../../categories/api/index.js', () => ({
  categoriesApi: { list: vi.fn() },
}));
vi.mock('../../products/api/index.js', () => ({
  productsApi: { list: vi.fn() },
}));
vi.mock('../api/index.js', () => ({
  bannersApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(bannersApi);
const categoryApi = vi.mocked(categoriesApi);
const productApi = vi.mocked(productsApi);
const banner: AdminBannerView = {
  id: 'banner-1',
  image: {
    objectKey: 'banners/summer.webp',
    publicUrl: 'https://cdn.example.com/banners/summer.webp',
  },
  title: '夏日限定',
  targetType: BannerTargetType.PRODUCT,
  targetId: 'product-1',
  sortOrder: 10,
  isActive: true,
  createdAt: '2026-07-18T08:00:00.000Z',
  updatedAt: '2026-07-18T09:00:00.000Z',
};
const category = {
  id: 'category-1',
  name: '蛋糕',
  sortOrder: 0,
  isActive: true,
} as AdminCategoryView;
const product = {
  id: 'product-1',
  categoryId: 'category-1',
  categoryName: '蛋糕',
  name: '草莓奶油蛋糕',
  coverImage: null,
  sortOrder: 0,
  isActive: true,
  activeSkuCount: 1,
  createdAt: '2026-07-18T08:00:00.000Z',
  updatedAt: '2026-07-18T09:00:00.000Z',
} as AdminProductSummaryView;

const bannerResult = (
  items: AdminBannerView[] = [banner],
  page = 1,
  pageSize = 20,
): AdminBannerListResult => ({ items, total: items.length, page, pageSize });
const categoryResult: AdminCategoryListResult = {
  items: [category],
  total: 1,
  page: 1,
  pageSize: 100,
};
const productResult: AdminProductListResult = {
  items: [product],
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

describe('useBanners', () => {
  afterEach(() => vi.resetAllMocks());

  it('loads paginated banners and valid target options in parallel', async () => {
    api.list.mockResolvedValueOnce(bannerResult());
    categoryApi.list.mockResolvedValueOnce(categoryResult);
    productApi.list.mockResolvedValueOnce(productResult);
    const state = useBanners();

    await state.initialize();

    expect(api.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(categoryApi.list).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
    expect(productApi.list).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
    expect(state.banners.value).toEqual([banner]);
    expect(state.categories.value).toEqual([category]);
    expect(state.products.value).toEqual([product]);
  });

  it('loads every option page and reports a partial option failure without hiding banners', async () => {
    const secondProduct = { ...product, id: 'product-101' };
    api.list.mockResolvedValueOnce(bannerResult());
    categoryApi.list.mockResolvedValueOnce(categoryResult);
    productApi.list
      .mockResolvedValueOnce({ ...productResult, total: 101 })
      .mockResolvedValueOnce({
        items: [secondProduct],
        total: 101,
        page: 2,
        pageSize: 100,
      });
    const success = useBanners();

    await success.initialize();

    expect(productApi.list).toHaveBeenNthCalledWith(2, {
      page: 2,
      pageSize: 100,
    });
    expect(success.products.value).toEqual([product, secondProduct]);

    api.list.mockResolvedValueOnce(bannerResult());
    categoryApi.list.mockRejectedValueOnce(new Error('分类失败'));
    productApi.list.mockResolvedValueOnce(productResult);
    const failure = useBanners();
    await failure.initialize();

    expect(failure.banners.value).toEqual([banner]);
    expect(failure.products.value).toEqual([product]);
    expect(failure.lastError.value).toBe('Banner 跳转选项加载失败，请重试');
  });

  it('applies target-dependent filters only on search and resets pagination consistently', async () => {
    api.list.mockImplementation((query) =>
      Promise.resolve(bannerResult([banner], query.page, query.pageSize)),
    );
    categoryApi.list.mockResolvedValue(categoryResult);
    productApi.list.mockResolvedValue(productResult);
    const state = useBanners();
    await state.initialize();

    state.draftFilters.q = '  夏日  ';
    state.draftFilters.targetType = BannerTargetType.PRODUCT;
    state.draftFilters.targetId = product.id;
    state.draftFilters.targetValid = BooleanFilter.YES;
    await state.setPage(3);
    expect(api.list).toHaveBeenLastCalledWith({ page: 3, pageSize: 20 });

    await state.search();
    expect(api.list).toHaveBeenLastCalledWith({
      q: '夏日',
      targetType: BannerTargetType.PRODUCT,
      targetId: product.id,
      targetValid: BooleanFilter.YES,
      page: 1,
      pageSize: 20,
    });
    expect(state.advancedCount.value).toBe(2);

    await state.setPageSize(50);
    expect(api.list).toHaveBeenLastCalledWith({
      q: '夏日',
      targetType: BannerTargetType.PRODUCT,
      targetId: product.id,
      targetValid: BooleanFilter.YES,
      page: 1,
      pageSize: 50,
    });

    await state.reset();
    expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 });
  });

  it('ignores stale list responses and keeps rows when a query fails', async () => {
    const stale = createDeferred<AdminBannerListResult>();
    const current = createDeferred<AdminBannerListResult>();
    api.list
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const state = useBanners();

    const firstLoad = state.refresh();
    const secondLoad = state.refresh();
    current.resolve(bannerResult([banner], 2));
    await secondLoad;
    stale.resolve(bannerResult([], 1));
    await firstLoad;

    expect(state.banners.value).toEqual([banner]);
    expect(state.page.value).toBe(2);

    api.list.mockRejectedValueOnce(new Error('查询失败'));
    await state.refresh();
    expect(state.banners.value).toEqual([banner]);
    expect(state.lastError.value).toBe('Banner 数据加载失败，请重试');
  });

  it('opens a legacy row without an owned image and requires re-upload before save', async () => {
    const state = useBanners();
    state.startEdit({ ...banner, image: null });

    expect(state.form.image).toBeNull();
    await expect(state.save()).rejects.toThrow('请先上传 Banner 图片');
    expect(api.update).not.toHaveBeenCalled();
  });

  it('clears the target id whenever the target type changes', () => {
    const state = useBanners();
    state.startEdit(banner);

    state.setTargetType(BannerTargetType.CATEGORY);

    expect(state.form.targetType).toBe(BannerTargetType.CATEGORY);
    expect(state.form.targetId).toBe('');
  });

  it('omits title and target id when saving a NONE banner', async () => {
    api.create.mockResolvedValueOnce({
      id: banner.id,
      image: banner.image,
      targetType: BannerTargetType.NONE,
      sortOrder: banner.sortOrder,
      isActive: banner.isActive,
      createdAt: banner.createdAt,
      updatedAt: banner.updatedAt,
    });
    api.list.mockResolvedValueOnce(bannerResult([]));
    const state = useBanners();
    state.openCreate();
    state.form.image = banner.image;
    state.form.title = '   ';
    state.setTargetType(BannerTargetType.NONE);

    await state.save();

    expect(api.create).toHaveBeenCalledWith({
      image: banner.image,
      targetType: BannerTargetType.NONE,
      sortOrder: 0,
      isActive: true,
    });
  });

  it('keeps successful mutations locally when the best-effort refresh fails', async () => {
    const state = useBanners();
    state.banners.value = [banner];

    const edited = { ...banner, title: '已更新' };
    api.update.mockResolvedValueOnce(edited);
    api.list.mockRejectedValueOnce(new Error('刷新失败'));
    state.startEdit(banner);
    state.form.title = '已更新';
    await state.save();
    expect(state.banners.value).toEqual([edited]);

    const toggled = { ...edited, isActive: false };
    api.update.mockResolvedValueOnce(toggled);
    api.list.mockRejectedValueOnce(new Error('刷新失败'));
    await state.toggleActive(edited);
    expect(state.banners.value).toEqual([toggled]);

    api.remove.mockResolvedValueOnce(undefined);
    api.list.mockRejectedValueOnce(new Error('刷新失败'));
    await state.remove(toggled.id);
    expect(state.banners.value).toEqual([]);
    expect(state.lastError.value).toBe('Banner 已删除，但列表刷新失败');
  });

  it('rejects saving while the image is missing or uploading', async () => {
    const state = useBanners();
    state.openCreate();

    await expect(state.save()).rejects.toThrow('请先上传 Banner 图片');
    state.form.image = banner.image;
    state.setUploading(true);
    await expect(state.save()).rejects.toThrow('图片仍在上传中');
    expect(api.create).not.toHaveBeenCalled();
  });
});
