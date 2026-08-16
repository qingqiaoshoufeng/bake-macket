import {
  HomepageDraftStatus,
  HomepageInternalPage,
  HomepageLinkType,
  HomepageSectionType,
  type AdminHomepageDraftListView,
  type AdminHomepageView,
  type HomepageDraftConfig,
  type MediaAsset,
} from '@bake-mall/contracts';

const DEMO_MEDIA_BASE_URL = 'https://media.example.invalid';

const demoAsset = (hash: string, fileName: string): MediaAsset => {
  const objectKey = `homepage/demo/v1/${hash.slice(0, 12)}-${fileName}`;
  return {
    objectKey,
    publicUrl: `${DEMO_MEDIA_BASE_URL}/${objectKey}`,
  };
};

export const HOMEPAGE_PREVIEW_MOCK: HomepageDraftConfig = {
  schemaVersion: 1,
  hero: {
    id: 'hero',
    type: HomepageSectionType.HERO_CAROUSEL,
    enabled: true,
    autoplayMs: 5000,
    slides: [
      {
        id: 'hero-birthday',
        image: demoAsset(
          '084a77cd72766ae59afb5643f1b2561fbf7b9635f78d37bf2393aded580aeb0e',
          'hero-birthday-cake.webp',
        ),
        title: '把生日的心意，做成一块蛋糕',
        subtitle: '当日手作奶油与时令水果，留住值得纪念的一天',
        altText: '焦糖色背景前装饰细腻的生日蛋糕',
        link: {
          type: HomepageLinkType.PAGE,
          page: HomepageInternalPage.PRODUCTS,
        },
      },
      {
        id: 'hero-afternoon-tea',
        image: demoAsset(
          '26140b2d90e57186e1a86a774488066ccec3d5599e06aa48f942c241506f8039',
          'hero-afternoon-tea.webp',
        ),
        title: '午后三点，留给刚出炉的甜',
        subtitle: '一份小蛋糕，一杯茶，把普通日子过得柔软一点',
        altText: '日光餐桌上的蛋糕与下午茶点心',
        link: {
          type: HomepageLinkType.PAGE,
          page: HomepageInternalPage.PRODUCTS,
        },
      },
    ],
  },
  customerService: {
    id: 'customer-service',
    type: HomepageSectionType.CUSTOMER_SERVICE,
    enabled: true,
    title: '和烘焙师聊聊',
    description: '生日祝福、口味偏好与取餐时间，都可以在下单前告诉我们。',
    phone: '400-xxx-xxxx',
    serviceHours: '每日 09:00–20:00（开发示例）',
    wechatQrCode: demoAsset(
      '169001b7d7c57cda9ec8e0d8571a734686731804479c00d8d0885d1d678458b6',
      'customer-service-placeholder.webp',
    ),
  },
  shortcutGrid: {
    id: 'shortcut-grid',
    type: HomepageSectionType.SHORTCUT_GRID,
    enabled: true,
    title: '今天想吃什么',
    layout: 4,
    items: [
      {
        id: 'shortcut-cake',
        label: '生日蛋糕',
        image: demoAsset(
          '80dabe22755fea2415166f763ac03583994a09427810262d8b9512be82c269ae',
          'shortcut-cake.webp',
        ),
        link: {
          type: HomepageLinkType.PAGE,
          page: HomepageInternalPage.PRODUCTS,
        },
      },
      {
        id: 'shortcut-bread',
        label: '每日面包',
        image: demoAsset(
          '7549ceacee3e5c517942290cf2c3806b37cdf178ee953a69b5716a915ef63816',
          'shortcut-bread.webp',
        ),
        link: {
          type: HomepageLinkType.PAGE,
          page: HomepageInternalPage.PRODUCTS,
        },
      },
      {
        id: 'shortcut-gift',
        label: '心意礼盒',
        image: demoAsset(
          '19913cfb6b0b7b99b9265fe550dc6877be65a9e1f9d51b61c38f63ee4fefa925',
          'shortcut-gift.webp',
        ),
        link: {
          type: HomepageLinkType.PAGE,
          page: HomepageInternalPage.MEMBERSHIP_CARDS,
        },
      },
      {
        id: 'shortcut-service',
        label: '联系客服',
        image: demoAsset(
          '03252914f18601ed7527cad0aabeb2f05b9e757149383954b5f5dbfa2f642d72',
          'shortcut-service.webp',
        ),
        link: { type: HomepageLinkType.NONE },
      },
    ],
  },
  imageBlocks: [
    {
      id: 'block-morning-bread',
      type: HomepageSectionType.IMAGE_BLOCK,
      enabled: true,
      image: demoAsset(
        'b7c222b12a5befc2fe629d63e542d0d869f35417acae127bcfdabad071975e26',
        'block-morning-bread.webp',
      ),
      title: '清晨出炉的麦香',
      description: '从柔软吐司到外脆内润的欧包，每日少量烘焙。',
      altText: '木桌上刚出炉的手作面包',
      link: {
        type: HomepageLinkType.PAGE,
        page: HomepageInternalPage.PRODUCTS,
      },
    },
    {
      id: 'block-weekend-box',
      type: HomepageSectionType.IMAGE_BLOCK,
      enabled: true,
      image: demoAsset(
        '38aaf2239105f87fbc230f287093c15382aa22c584c0400268dc5e832894bba6',
        'block-weekend-box.webp',
      ),
      title: '周末甜点盒',
      description: '把几种小小的甜装进一盒，适合分享，也适合独享。',
      altText: '整齐摆放的彩色奶油纸杯蛋糕',
      link: {
        type: HomepageLinkType.PAGE,
        page: HomepageInternalPage.PRODUCTS,
      },
    },
  ],
};

export const HOMEPAGE_DRAFT_DETAIL_MOCK: AdminHomepageView = {
  id: '1',
  pageKey: 'HOME',
  name: '当前首页',
  status: HomepageDraftStatus.PUBLISHED,
  draftConfig: HOMEPAGE_PREVIEW_MOCK,
  publishedConfig: null,
  version: 3,
  publishedVersion: 2,
  updatedAt: '2026-08-01T01:00:00.000Z',
  createdAt: '2026-07-31T00:00:00.000Z',
  publishedAt: '2026-08-01T00:30:00.000Z',
  draftIssues: [],
};

export const HOMEPAGE_DRAFT_LIST_MOCK: AdminHomepageDraftListView = {
  items: [
    {
      id: HOMEPAGE_DRAFT_DETAIL_MOCK.id,
      name: HOMEPAGE_DRAFT_DETAIL_MOCK.name ?? '当前首页',
      status:
        HOMEPAGE_DRAFT_DETAIL_MOCK.status ?? HomepageDraftStatus.PUBLISHED,
      version: HOMEPAGE_DRAFT_DETAIL_MOCK.version,
      updatedAt: HOMEPAGE_DRAFT_DETAIL_MOCK.updatedAt ?? '',
      createdAt: HOMEPAGE_DRAFT_DETAIL_MOCK.createdAt ?? '',
    },
    {
      id: '2',
      name: '七夕活动',
      status: HomepageDraftStatus.DRAFT,
      version: 1,
      updatedAt: '2026-08-01T02:00:00.000Z',
      createdAt: '2026-08-01T02:00:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  publishedDraftId: HOMEPAGE_DRAFT_DETAIL_MOCK.id,
};
