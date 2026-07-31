import {
  BannerTargetType,
  HomepageLinkType,
  type BannerView,
} from '@bake-mall/contracts';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../App.vue';
import { catalogFeatureApi } from '../catalog/api/index.js';
import { catalogMock } from '../catalog/mock/catalog.mock.js';
import { homepageApi } from './api/index.js';
import HomepageView from './HomepageView.vue';
import { HOMEPAGE_MOCK } from './mock/homepage.mock.js';

vi.mock('./api/index.js', () => ({
  homepageApi: {
    get: vi.fn(),
  },
}));

vi.mock('../catalog/api/index.js', () => ({
  catalogFeatureApi: {
    listBanners: vi.fn(),
    listCategories: vi.fn(),
    listProducts: vi.fn(),
    getProduct: vi.fn(),
  },
}));

const homepageApiMock = vi.mocked(homepageApi);
const catalogApiMock = vi.mocked(catalogFeatureApi);

const PUBLISHED_HOMEPAGE = {
  ...HOMEPAGE_MOCK,
  config: {
    ...HOMEPAGE_MOCK.config,
    hero: {
      ...HOMEPAGE_MOCK.config.hero,
      slides: [
        {
          id: 'hero-welcome',
          image: { imageUrl: 'https://cdn.example.com/homepage/welcome.webp' },
          title: '今天也要甜一点',
          subtitle: '门店新鲜制作',
          altText: '首页欢迎横幅',
          link: { type: HomepageLinkType.NONE },
        },
      ],
    },
  },
} as const;

const UNAVAILABLE_PRODUCTS = catalogMock.products.map((product) => ({
  ...product,
  id: `${product.id}-sold-out`,
  name: `${product.name}（已售罄）`,
  skus: product.skus.map((sku) => ({ ...sku, isAvailable: false })),
}));

const PUBLIC_BANNER_CASES = [
  {
    name: 'NONE 保持非交互并且不改变路由',
    banner: {
      id: 'banner-none',
      imageUrl: 'https://cdn.example.com/banners/none.webp',
      title: '只看不跳转',
      targetType: BannerTargetType.NONE,
    },
    expectedPath: '/',
    interactive: false,
  },
  {
    name: 'PRODUCT 作为按钮跳转商品详情',
    banner: {
      id: 'banner-product',
      imageUrl: 'https://cdn.example.com/banners/product.webp',
      title: '查看草莓蛋糕',
      targetType: BannerTargetType.PRODUCT,
      targetId: 'product-strawberry',
    },
    expectedPath: '/products/product-strawberry',
    interactive: true,
  },
  {
    name: 'CATEGORY 作为按钮跳转分类',
    banner: {
      id: 'banner-category',
      imageUrl: 'https://cdn.example.com/banners/category.webp',
      title: '查看现烤面包',
      targetType: BannerTargetType.CATEGORY,
      targetId: 'bread',
    },
    expectedPath: '/category/bread',
    interactive: true,
  },
] as const satisfies readonly {
  readonly name: string;
  readonly banner: BannerView;
  readonly expectedPath: string;
  readonly interactive: boolean;
}[];

function findVisibleElement(wrapper: VueWrapper, text: string): Element {
  const element = wrapper
    .findAll('*')
    .find((candidate) => candidate.text().trim() === text)?.element;
  expect(element, `应显示“${text}”`).toBeDefined();
  if (!element) throw new Error(`未找到“${text}”`);
  return element;
}

function expectVisibleOrder(
  wrapper: VueWrapper,
  texts: readonly string[],
): void {
  const elements = texts.map((text) => findVisibleElement(wrapper, text));

  elements.slice(1).forEach((element, index) => {
    const previousElement = elements[index];
    if (!previousElement) throw new Error(`未找到“${texts[index]}”`);
    expect(
      previousElement.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      `“${texts[index]}”应位于“${texts[index + 1]}”之前`,
    ).not.toBe(0);
  });
}

async function mountHomepageRoute(): Promise<{
  wrapper: ReturnType<typeof mount>;
  router: Router;
}> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: HomepageView,
        meta: { showTabbar: true, tabbarKey: 'home' },
      },
      { path: '/products', component: { template: '<div />' } },
      { path: '/products/:id', component: { template: '<div />' } },
      { path: '/category/:id', component: { template: '<div />' } },
      { path: '/cart', component: { template: '<div />' } },
      { path: '/orders', component: { template: '<div />' } },
      { path: '/profile', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();

  const wrapper = mount(App, {
    global: { plugins: [createPinia(), router] },
  });
  await flushPromises();
  return { wrapper, router };
}

describe('HomepageView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    homepageApiMock.get.mockResolvedValue(PUBLISHED_HOMEPAGE);
    catalogApiMock.listBanners.mockResolvedValue(catalogMock.banners);
    catalogApiMock.listCategories.mockResolvedValue(catalogMock.categories);
    catalogApiMock.listProducts.mockResolvedValue(catalogMock.products);
  });

  it('renders the fixed homepage regions before optional decoration content', async () => {
    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    expectVisibleOrder(wrapper, [
      '今天也要甜一点',
      '单层分类',
      '人气烘焙',
      '下一炉，值得期待',
      '快捷入口',
      '首页',
    ]);
    expect(wrapper.text()).toContain('节日限定与季节风味正在准备中。');
    expect(
      wrapper.get('[data-testid="homepage-product-grid"]').classes(),
    ).toContain('product-grid');
    expect(wrapper.findAll('[data-testid^="product-card-"]')).toHaveLength(2);
    expect(
      wrapper.get('[data-testid="store-tabbar"]').attributes('aria-label'),
    ).toBe('商城主导航');
    expect(catalogApiMock.listCategories).toHaveBeenCalledTimes(1);
    expect(catalogApiMock.listProducts).toHaveBeenCalledTimes(1);
  });

  it('excludes products without an available SKU from the homepage feed', async () => {
    catalogApiMock.listProducts.mockResolvedValue([
      catalogMock.products[0],
      ...UNAVAILABLE_PRODUCTS,
    ]);

    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    expect(wrapper.text()).not.toContain('（已售罄）');
    expect(wrapper.findAll('[data-testid^="product-card-"]')).toHaveLength(1);
  });

  it.each([
    {
      name: 'decoration is loading',
      arrange: () =>
        homepageApiMock.get.mockImplementationOnce(
          () => new Promise(() => undefined),
        ),
      expectedState: '正在准备首页',
    },
    {
      name: 'no decoration is published',
      arrange: () => homepageApiMock.get.mockResolvedValueOnce(null),
      expectedState: '首页正在准备中',
    },
    {
      name: 'decoration fails to load',
      arrange: () =>
        homepageApiMock.get.mockRejectedValueOnce(
          new Error('装修服务暂不可用'),
        ),
      expectedState: '装修服务暂不可用',
    },
  ])(
    'shows the public Banner before automatic categories when $name',
    async ({ arrange, expectedState }) => {
      arrange();

      const { wrapper, router } = await mountHomepageRoute();

      await vi.waitFor(() =>
        expect(wrapper.text()).toContain('今日现烤 · 松软出炉'),
      );

      expectVisibleOrder(wrapper, [
        '今日现烤 · 松软出炉',
        '单层分类',
        '人气烘焙',
        '下一炉，值得期待',
        expectedState,
      ]);
      expect(wrapper.text()).toContain('草莓云朵蛋糕');

      await wrapper
        .get('[data-testid="catalog-banner-banner-summer"]')
        .trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.fullPath).toBe('/category/bread');
    },
  );

  it('falls back to the public Banner when decoration has no valid Hero', async () => {
    homepageApiMock.get.mockResolvedValueOnce(HOMEPAGE_MOCK);

    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('今日现烤 · 松软出炉'),
    );

    expectVisibleOrder(wrapper, ['今日现烤 · 松软出炉', '单层分类']);
  });

  it('keeps a valid decoration Hero primary without repeating the public Banner', async () => {
    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() => expect(wrapper.text()).toContain('今天也要甜一点'));

    expect(wrapper.text()).not.toContain('今日现烤 · 松软出炉');
    expect(wrapper.find('[data-testid^="catalog-banner-"]').exists()).toBe(
      false,
    );
    expect(catalogApiMock.listBanners).toHaveBeenCalledTimes(1);
  });

  it.each(PUBLIC_BANNER_CASES)(
    'renders and handles a real public Banner: $name',
    async ({ banner, expectedPath, interactive }) => {
      homepageApiMock.get.mockResolvedValueOnce(null);
      catalogApiMock.listBanners.mockResolvedValueOnce([banner]);

      const { wrapper, router } = await mountHomepageRoute();

      await vi.waitFor(() => expect(wrapper.text()).toContain(banner.title));
      const frame = wrapper.get(`[data-testid="catalog-banner-${banner.id}"]`);
      expect(frame.element.tagName).toBe(interactive ? 'BUTTON' : 'DIV');
      expect(frame.attributes('role')).toBeUndefined();
      expect(frame.attributes('tabindex')).toBeUndefined();
      await frame.trigger('click');
      await flushPromises();

      expect(router.currentRoute.value.fullPath).toBe(expectedPath);
    },
  );

  it('keeps successful categories and products when the public Banner fails', async () => {
    catalogApiMock.listBanners.mockRejectedValueOnce(
      new Error('Banner 服务暂不可用'),
    );

    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Banner 服务暂不可用'),
    );

    expect(wrapper.text()).toContain('今天也要甜一点');
    expect(wrapper.text()).toContain('快捷入口');
    expect(wrapper.text()).toContain('单层分类');
    expect(wrapper.text()).toContain('草莓云朵蛋糕');
    expect(wrapper.findAll('[data-testid^="product-card-"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid^="catalog-banner-"]').exists()).toBe(
      false,
    );
  });

  it('keeps the public Banner and categories when products fail', async () => {
    homepageApiMock.get.mockResolvedValueOnce(null);
    catalogApiMock.listProducts.mockRejectedValueOnce(
      new Error('商品服务暂不可用'),
    );

    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('商品服务暂不可用'),
    );

    expectVisibleOrder(wrapper, [
      '今日现烤 · 松软出炉',
      '单层分类',
      '人气烘焙',
      '下一炉，值得期待',
      '首页正在准备中',
    ]);
    expect(wrapper.findAll('[data-testid^="product-card-"]')).toHaveLength(0);
  });

  it('keeps the public Banner and products when categories fail', async () => {
    homepageApiMock.get.mockResolvedValueOnce(null);
    catalogApiMock.listCategories.mockRejectedValueOnce(
      new Error('分类服务暂不可用'),
    );

    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('分类服务暂不可用'),
    );

    expect(wrapper.text()).toContain('今日现烤 · 松软出炉');
    expect(wrapper.text()).toContain('草莓云朵蛋糕');
    expect(wrapper.findAll('[data-testid^="product-card-"]')).toHaveLength(2);
    expect(wrapper.text()).toContain('下一炉，值得期待');
  });
});
