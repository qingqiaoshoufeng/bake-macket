import type { PublicProductDetailView } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App.vue';
import { catalogFeatureApi } from './catalog/api/index.js';
import ProductDetailView from './ProductDetailView.vue';

vi.mock('./catalog/api/index.js', () => ({
  catalogFeatureApi: {
    listBanners: vi.fn(),
    listCategories: vi.fn(),
    listProducts: vi.fn(),
    getProduct: vi.fn(),
  },
}));

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
    {
      id: 'sku-zero',
      name: '8寸',
      attributes: {},
      priceCents: 8800,
      stock: 0,
      isAvailable: false,
    },
  ],
};

async function mountDetail(path = '/products/product-1') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/products/:id',
        component: ProductDetailView,
        meta: { showTabbar: true, tabbarKey: 'products' },
      },
      { path: '/login', component: { template: '<div />' } },
      { path: '/cart', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  return {
    router,
    wrapper: mount(App, { global: { plugins: [pinia, router] } }),
  };
}

describe('ProductDetailView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(catalogFeatureApi.getProduct).mockResolvedValue(detail);
  });

  it('renders the saved HTML and opens the SKU action sheet', async () => {
    const { wrapper } = await mountDetail();
    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    expect(wrapper.html()).toContain('服务端清洗后的商品详情');
    expect(wrapper.find('.store-page').exists()).toBe(true);
    expect(wrapper.find('.store-section').exists()).toBe(true);
    expect(
      wrapper.get('[data-testid="store-tabbar"]').attributes('aria-label'),
    ).toBe('商城主导航');
    await wrapper.get('[data-testid="choose-sku"]').trigger('click');
    expect(wrapper.find('[data-testid="sku-sheet"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="store-tabbar"]').exists()).toBe(true);
    expect(
      (wrapper.get('[data-testid="sku-sku-live"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (wrapper.get('[data-testid="sku-sku-zero"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('clears the old product and SKU sheet before loading a reused route id', async () => {
    const nextDetail = {
      ...detail,
      id: 'product-2',
      name: '蓝莓云朵蛋糕',
    };
    let resolveNext!: (value: PublicProductDetailView) => void;
    vi.mocked(catalogFeatureApi.getProduct)
      .mockResolvedValueOnce(detail)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNext = resolve;
        }),
      );
    const { router, wrapper } = await mountDetail();
    await vi.waitFor(() => expect(wrapper.text()).toContain(detail.name));
    await wrapper.get('[data-testid="choose-sku"]').trigger('click');

    await router.push('/products/product-2');
    await vi.waitFor(() =>
      expect(catalogFeatureApi.getProduct).toHaveBeenLastCalledWith(
        'product-2',
      ),
    );

    expect(wrapper.text()).not.toContain(detail.name);
    expect(wrapper.find('[data-testid="sku-sheet"]').exists()).toBe(false);
    resolveNext(nextDetail);
    await vi.waitFor(() => expect(wrapper.text()).toContain(nextDetail.name));
  });
});
