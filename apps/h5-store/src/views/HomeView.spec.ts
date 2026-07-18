import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { BannerTargetType } from '@bake-mall/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogFeatureApi } from './catalog/api/index.js';
import { catalogMock } from './catalog/mock/catalog.mock.js';
import HomeView from './HomeView.vue';

vi.mock('./catalog/api/index.js', () => ({
  catalogFeatureApi: {
    listBanners: vi.fn(),
    listCategories: vi.fn(),
    listProducts: vi.fn(),
    getProduct: vi.fn(),
  },
}));

const api = vi.mocked(catalogFeatureApi);

async function mountHome(): Promise<{
  wrapper: ReturnType<typeof mount>;
  router: Router;
}> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/category/:id', component: { template: '<div />' } },
      { path: '/products/:id', component: { template: '<div />' } },
      { path: '/cart', component: { template: '<div />' } },
      { path: '/orders', component: { template: '<div />' } },
      { path: '/profile', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(HomeView, {
    global: { plugins: [createPinia(), router] },
  });
  await flushPromises();
  return { wrapper, router };
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listBanners.mockResolvedValue(catalogMock.banners);
    api.listCategories.mockResolvedValue(catalogMock.categories);
    api.listProducts.mockResolvedValue(catalogMock.products);
  });

  it('renders banners, category entries, and the product discovery grid', async () => {
    const { wrapper } = await mountHome();

    await vi.waitFor(() => expect(wrapper.text()).toContain('生日蛋糕'));

    expect(api.listProducts).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('今日新鲜出炉');
    expect(wrapper.text()).toContain('草莓云朵蛋糕');
    expect(wrapper.findAll('[data-testid^="product-card-"]')).toHaveLength(2);
  });

  it.each([
    {
      banner: {
        id: 'banner-product',
        imageUrl: 'https://cdn.example.com/banner.webp',
        title: '跳转测试',
        targetType: BannerTargetType.PRODUCT,
        targetId: 'product-strawberry',
      } as const,
      path: '/products/product-strawberry',
    },
    {
      banner: {
        id: 'banner-category',
        imageUrl: 'https://cdn.example.com/banner.webp',
        title: '跳转测试',
        targetType: BannerTargetType.CATEGORY,
        targetId: 'bread',
      } as const,
      path: '/category/bread',
    },
  ])(
    'navigates a $banner.targetType Banner to its exact target',
    async ({ banner, path }) => {
      api.listBanners.mockResolvedValueOnce([banner]);
      const { wrapper, router } = await mountHome();
      await vi.waitFor(() => expect(wrapper.text()).toContain('跳转测试'));

      await wrapper.get('[data-testid^="home-banner-"]').trigger('click');
      await flushPromises();

      expect(router.currentRoute.value.fullPath).toBe(path);
    },
  );

  it('keeps a NONE Banner on the homepage and renders banners before the hero', async () => {
    api.listBanners.mockResolvedValueOnce([
      {
        id: 'banner-none',
        imageUrl: 'https://cdn.example.com/banner.webp',
        targetType: BannerTargetType.NONE,
      },
    ]);
    const { wrapper, router } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain('门店今日推荐'));

    await wrapper
      .get('[data-testid="home-banner-banner-none"]')
      .trigger('click');

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(wrapper.find('.home-shell').element.firstElementChild).toBe(
      wrapper.find('.banner-reel').element,
    );
  });
});
