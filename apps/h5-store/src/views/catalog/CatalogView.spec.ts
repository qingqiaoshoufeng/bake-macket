import { BannerTargetType, type BannerView } from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const api = vi.mocked(catalogFeatureApi);

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

const NAVIGABLE_BANNERS = [
  {
    id: 'banner-product',
    imageUrl: 'https://cdn.example.com/banner-product.webp',
    title: '查看蛋糕',
    targetType: BannerTargetType.PRODUCT,
    targetId: 'product-strawberry',
    expectedPath: '/products/product-strawberry',
  },
  {
    id: 'banner-category',
    imageUrl: 'https://cdn.example.com/banner-category.webp',
    title: '查看面包',
    targetType: BannerTargetType.CATEGORY,
    targetId: 'bread',
    expectedPath: '/category/bread',
  },
] as const satisfies readonly (BannerView & {
  readonly expectedPath: string;
})[];

describe('CatalogView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listBanners.mockResolvedValue(catalogMock.banners);
    api.listCategories.mockResolvedValue(catalogMock.categories);
    api.listProducts.mockResolvedValue(catalogMock.products);
  });

  it('renders the shared Banner reel with the catalog content', async () => {
    const { wrapper } = await mountCatalog();

    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    expect(wrapper.find('.banner-reel').exists()).toBe(true);
    expect(wrapper.text()).toContain('单层分类');
    expect(wrapper.findAll('[data-testid^="product-card-"]')).toHaveLength(2);
  });

  it.each(NAVIGABLE_BANNERS)(
    'keeps $targetType banners as buttons and navigates to their target',
    async ({ expectedPath, ...banner }) => {
      api.listBanners.mockResolvedValueOnce([banner]);
      const { wrapper, router } = await mountCatalog();
      const frame = wrapper.get(`[data-testid="catalog-banner-${banner.id}"]`);

      expect(frame.element.tagName).toBe('BUTTON');
      await frame.trigger('click');
      await flushPromises();

      expect(router.currentRoute.value.fullPath).toBe(expectedPath);
    },
  );

  it('renders a NONE banner without button or fake interactive semantics', async () => {
    api.listBanners.mockResolvedValueOnce([
      {
        id: 'banner-none',
        imageUrl: 'https://cdn.example.com/banner-none.webp',
        title: '门店推荐',
        targetType: BannerTargetType.NONE,
      },
    ]);
    const { wrapper, router } = await mountCatalog();
    const frame = wrapper.get('[data-testid="catalog-banner-banner-none"]');

    expect(frame.element.tagName).toBe('DIV');
    expect(frame.attributes('role')).toBeUndefined();
    expect(frame.attributes('tabindex')).toBeUndefined();
    await frame.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/products');
  });
});
