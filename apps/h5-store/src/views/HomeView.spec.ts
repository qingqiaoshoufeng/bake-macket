import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
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

function mountHome() {
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
  return mount(HomeView, { global: { plugins: [createPinia(), router] } });
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listBanners.mockResolvedValue(catalogMock.banners);
    api.listCategories.mockResolvedValue(catalogMock.categories);
    api.listProducts.mockResolvedValue(catalogMock.products);
  });

  it('renders banners, category entries, and the product discovery grid', async () => {
    const wrapper = mountHome();

    await vi.waitFor(() => expect(wrapper.text()).toContain('生日蛋糕'));

    expect(api.listProducts).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('今日新鲜出炉');
    expect(wrapper.text()).toContain('草莓云朵蛋糕');
    expect(wrapper.findAll('[data-testid^="product-card-"]')).toHaveLength(2);
  });
});
