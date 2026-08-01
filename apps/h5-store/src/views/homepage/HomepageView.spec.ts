import {
  HomepageInternalPage,
  HomepageLinkType,
  HomepageSectionType,
  type PublicHomepageView,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../App.vue';
import { catalogFeatureApi } from '../catalog/api/index.js';
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
  },
}));

const homepageApiMock = vi.mocked(homepageApi);
const catalogApiMock = vi.mocked(catalogFeatureApi);

const PUBLISHED_HOMEPAGE: PublicHomepageView = {
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
          link: { type: HomepageLinkType.PAGE, page: HomepageInternalPage.PRODUCTS },
        },
      ],
    },
    customerService: {
      ...HOMEPAGE_MOCK.config.customerService,
      title: '烘焙师在线',
      description: '定制蛋糕请提前联系',
    },
    shortcutGrid: {
      ...HOMEPAGE_MOCK.config.shortcutGrid,
      title: '本周精选',
      items: [
        {
          id: 'shortcut-products',
          label: '浏览商品',
          image: { imageUrl: '' },
          link: { type: HomepageLinkType.PAGE, page: HomepageInternalPage.PRODUCTS },
        },
      ],
    },
    imageBlocks: [
      {
        id: 'seasonal-block',
        type: HomepageSectionType.IMAGE_BLOCK,
        enabled: true,
        image: { imageUrl: 'https://cdn.example.com/homepage/seasonal.webp' },
        title: '季节限定',
        description: '夏日水果系列',
        altText: '季节限定烘焙',
        link: { type: HomepageLinkType.NONE },
      },
    ],
  },
};

async function mountHomepageRoute(): Promise<{
  readonly wrapper: ReturnType<typeof mount>;
  readonly router: Router;
}> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: HomepageView,
        meta: { showTabbar: true, tabbarKey: 'home' },
      },
      { path: '/products', component: { template: '<div>商品页</div>' } },
      { path: '/products/:id', component: { template: '<div />' } },
      { path: '/category/:id', component: { template: '<div />' } },
      { path: '/cart', component: { template: '<div />' } },
      { path: '/orders', component: { template: '<div />' } },
      { path: '/profile', component: { template: '<div />' } },
      { path: '/membership-cards', component: { template: '<div />' } },
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

function expectNoCatalogRequests(): void {
  expect(catalogApiMock.listBanners).not.toHaveBeenCalled();
  expect(catalogApiMock.listCategories).not.toHaveBeenCalled();
  expect(catalogApiMock.listProducts).not.toHaveBeenCalled();
}

describe('HomepageView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    homepageApiMock.get.mockResolvedValue(PUBLISHED_HOMEPAGE);
  });

  it('renders only published decoration sections in their fixed order', async () => {
    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() => expect(wrapper.text()).toContain('今天也要甜一点'));

    expect(homepageApiMock.get).toHaveBeenCalledTimes(1);
    expectNoCatalogRequests();
    expect(wrapper.text()).toContain('烘焙师在线');
    expect(wrapper.text()).toContain('本周精选');
    expect(wrapper.text()).toContain('季节限定');
    expect(wrapper.text()).not.toContain('单层分类');
    expect(wrapper.text()).not.toContain('人气烘焙');
    expect(wrapper.text()).not.toContain('下一炉，值得期待');
    expect(wrapper.find('[data-testid="homepage-product-grid"]').exists()).toBe(false);

    const sectionTexts = ['今天也要甜一点', '烘焙师在线', '本周精选', '季节限定'];
    const elements = sectionTexts.map((text) => {
      const element = wrapper.findAll('*').find((candidate) => candidate.text().trim() === text)?.element;
      expect(element, `应显示“${text}”`).toBeDefined();
      return element!;
    });
    elements.slice(1).forEach((element, index) => {
      expect(elements[index]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    });
  });

  it('navigates decoration links without loading catalog data', async () => {
    const { wrapper, router } = await mountHomepageRoute();

    await vi.waitFor(() => expect(wrapper.text()).toContain('浏览商品'));
    await wrapper.get('.homepage-shortcuts__item').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/products');
    expectNoCatalogRequests();
  });

  it('shows a loading state while the published homepage is loading', async () => {
    homepageApiMock.get.mockImplementationOnce(() => new Promise(() => undefined));

    const { wrapper } = await mountHomepageRoute();

    expect(wrapper.text()).toContain('正在准备首页');
    expectNoCatalogRequests();
  });

  it('shows the load error and retries only the homepage request', async () => {
    homepageApiMock.get
      .mockRejectedValueOnce(new Error('装修服务暂不可用'))
      .mockResolvedValueOnce(PUBLISHED_HOMEPAGE);

    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() => expect(wrapper.text()).toContain('装修服务暂不可用'));
    await wrapper.get('button.homepage-view__action').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('今天也要甜一点'));

    expect(homepageApiMock.get).toHaveBeenCalledTimes(2);
    expectNoCatalogRequests();
  });

  it('shows the unpublished state and goes to products on request', async () => {
    homepageApiMock.get.mockResolvedValueOnce(null);

    const { wrapper, router } = await mountHomepageRoute();

    await vi.waitFor(() => expect(wrapper.text()).toContain('首页正在准备中'));
    await wrapper.get('button.homepage-view__action').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/products');
    expectNoCatalogRequests();
  });

  it('shows an error for an unsupported homepage schema without catalog fallback', async () => {
    homepageApiMock.get.mockResolvedValueOnce({
      ...PUBLISHED_HOMEPAGE,
      config: { ...PUBLISHED_HOMEPAGE.config, schemaVersion: 2 },
    } as unknown as PublicHomepageView);

    const { wrapper } = await mountHomepageRoute();

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('首页配置版本或区块类型暂不受支持'),
    );
    expectNoCatalogRequests();
  });
});
