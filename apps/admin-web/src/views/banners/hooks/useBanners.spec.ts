import {
  BannerTargetType,
  type AdminBannerView,
  type AdminCategoryView,
  type AdminProductSummaryView,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { adminCatalogApi } from '../../../api/catalog.js';
import { productsApi } from '../../products/api/index.js';
import { bannersApi } from '../api/index.js';
import { useBanners } from './useBanners.js';

vi.mock('../../../api/catalog.js', () => ({
  adminCatalogApi: { listCategories: vi.fn() },
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
const catalogApi = vi.mocked(adminCatalogApi);
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

describe('useBanners', () => {
  afterEach(() => vi.resetAllMocks());

  it('loads banners and valid targets in parallel', async () => {
    api.list.mockResolvedValueOnce([banner]);
    catalogApi.listCategories.mockResolvedValueOnce([category]);
    productApi.list.mockResolvedValueOnce([product]);
    const state = useBanners();

    await state.refresh();

    expect(state.banners.value).toEqual([banner]);
    expect(state.categories.value).toEqual([category]);
    expect(state.products.value).toEqual([product]);
    expect(state.loading.value).toBe(false);
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
    api.list.mockResolvedValueOnce([]);
    catalogApi.listCategories.mockResolvedValueOnce([]);
    productApi.list.mockResolvedValueOnce([]);
    const state = useBanners();
    state.openCreate();
    state.form.image = banner.image;
    state.form.title = '   ';
    state.setTargetType(BannerTargetType.NONE);

    await state.save();

    expect(catalogApi.listCategories).not.toHaveBeenCalled();
    expect(productApi.list).not.toHaveBeenCalled();
    expect(api.create).toHaveBeenCalledWith({
      image: banner.image,
      targetType: BannerTargetType.NONE,
      sortOrder: 0,
      isActive: true,
    });
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
