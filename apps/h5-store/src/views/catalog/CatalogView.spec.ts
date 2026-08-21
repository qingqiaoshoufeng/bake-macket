import { BannerTargetType } from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { homepageApi } from '../homepage/api/index.js';
import { HOMEPAGE_MOCK } from '../homepage/mock/homepage.mock.js';
import { catalogFeatureApi } from './api/index.js';
import CatalogView from './CatalogView.vue';
import { catalogMock } from './mock/catalog.mock.js';

vi.mock('./api/index.js', () => ({
  catalogFeatureApi: {
    listBanners: vi.fn(),
    listCategories: vi.fn(),
    listProducts: vi.fn(),
    getProduct: vi.fn(),
  },
}));

vi.mock('../homepage/api/index.js', () => ({
  homepageApi: { get: vi.fn() },
}));

const api = vi.mocked(catalogFeatureApi);
const homepageApiMock = vi.mocked(homepageApi);

async function mountCatalog(): Promise<{
  readonly wrapper: ReturnType<typeof mount>;
  readonly router: Router;
}> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/products', component: CatalogView },
      { path: '/products/:id', component: { template: '<div />' } },
      { path: '/category/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/products');
  await router.isReady();
  const wrapper = mount(CatalogView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe('CatalogView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    homepageApiMock.get.mockResolvedValue(HOMEPAGE_MOCK);
    api.listBanners.mockResolvedValue(catalogMock.banners);
    api.listCategories.mockResolvedValue(catalogMock.categories);
    api.listProducts.mockResolvedValue(catalogMock.products);
  });

  it('renders the formal left-category and grouped-product workspace', async () => {
    const { wrapper } = await mountCatalog();

    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    expect(wrapper.find('.catalog-page__carousel').exists()).toBe(true);
    expect(wrapper.text()).toContain('把生日的心意，做成一块蛋糕');
    expect(wrapper.text()).toContain('把刚刚好的甜，留给今天');
    expect(wrapper.text()).toContain('人气烘焙');
    expect(wrapper.text()).toContain('下一炉，值得期待');
    expect(wrapper.find('[aria-label="商品分类"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="catalog-product-pane"]').exists()).toBe(
      true,
    );
    expect(wrapper.findAll('[data-category-group]')).toHaveLength(3);
    expect(wrapper.findAll('[data-testid^="catalog-product-row-"]')).toHaveLength(
      2,
    );
  });

  it('keeps category selection on /products and shows an empty category state', async () => {
    const { wrapper, router } = await mountCatalog();
    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    const emptyCategory = wrapper.get('[data-category-button="tea"]');
    await emptyCategory.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/products');
    expect(wrapper.text()).toContain('该分类暂无商品');
    expect(wrapper.findAll('[data-testid^="catalog-product-row-"]')).toHaveLength(
      2,
    );
    expect(emptyCategory.classes()).toContain('is-active');
  });

  it('keeps every product rendered when a category anchor is selected', async () => {
    const { wrapper } = await mountCatalog();
    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    await wrapper.get('[data-category-button="cake"]').trigger('click');
    await flushPromises();

    expect(wrapper.findAll('[data-testid^="catalog-product-row-"]')).toHaveLength(
      2,
    );
    expect(wrapper.text()).toContain('草莓云朵蛋糕');
    expect(wrapper.text()).toContain('黄油可颂');
  });

  it('navigates from the published homepage carousel', async () => {
    const { wrapper, router } = await mountCatalog();

    await wrapper.get('.homepage-carousel__slide').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/products');
  });

  it('falls back to legacy banner navigation when homepage config is absent', async () => {
    homepageApiMock.get.mockResolvedValueOnce(null);
    api.listBanners.mockResolvedValueOnce([
      {
        id: 'banner-product',
        imageUrl: 'https://cdn.example.com/banner-product.webp',
        title: '查看蛋糕',
        targetType: BannerTargetType.PRODUCT,
        targetId: 'product-strawberry',
      },
    ]);
    const { wrapper, router } = await mountCatalog();

    await wrapper.get('[data-testid="catalog-banner-banner-product"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/products/product-strawberry');
  });

  it('opens a product from the row and keeps the catalog route', async () => {
    const { wrapper, router } = await mountCatalog();
    const productRow = wrapper.get(
      '[data-testid="catalog-product-row-product-strawberry"]',
    );

    await productRow.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/products/product-strawberry');
  });
});
