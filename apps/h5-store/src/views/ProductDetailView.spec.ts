import type { PublicProductDetailView } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

async function mountDetail() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/products/:id', component: ProductDetailView },
      { path: '/login', component: { template: '<div />' } },
      { path: '/cart', component: { template: '<div />' } },
    ],
  });
  await router.push('/products/product-1');
  await router.isReady();
  return mount(ProductDetailView, { global: { plugins: [pinia, router] } });
}

describe('ProductDetailView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(catalogFeatureApi.getProduct).mockResolvedValue(detail);
  });

  it('renders the saved HTML and opens the SKU action sheet', async () => {
    const wrapper = await mountDetail();
    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    expect(wrapper.html()).toContain('服务端清洗后的商品详情');
    await wrapper.get('[data-testid="choose-sku"]').trigger('click');
    expect(wrapper.find('[data-testid="sku-sheet"]').exists()).toBe(true);
    expect(
      (wrapper.get('[data-testid="sku-sku-live"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (wrapper.get('[data-testid="sku-sku-zero"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
