import {
  HomepageLinkType,
  HomepageSectionType,
  type PublicHomepageView,
} from '@bake-mall/contracts';

export const HOMEPAGE_MOCK: PublicHomepageView = {
  publishedVersion: 1,
  publishedAt: '2026-07-30T00:00:00.000Z',
  config: {
    schemaVersion: 1,
    hero: {
      id: 'hero',
      type: HomepageSectionType.HERO_CAROUSEL,
      enabled: true,
      autoplayMs: 5000,
      slides: [],
    },
    customerService: {
      id: 'customer-service',
      type: HomepageSectionType.CUSTOMER_SERVICE,
      enabled: true,
      title: '联系客服',
      description: '如需定制或帮助，欢迎联系我们',
      phone: '13800000000',
      serviceHours: '每日 09:00–20:00',
      wechatQrCode: { imageUrl: '' },
    },
    shortcutGrid: {
      id: 'shortcut-grid',
      type: HomepageSectionType.SHORTCUT_GRID,
      enabled: true,
      title: '快捷入口',
      layout: 3,
      items: Array.from({ length: 3 }, (_, index) => ({
        id: `shortcut-${index + 1}`,
        label: `入口 ${index + 1}`,
        image: { imageUrl: '' },
        link: { type: HomepageLinkType.NONE },
      })),
    },
    imageBlocks: [],
  },
};
