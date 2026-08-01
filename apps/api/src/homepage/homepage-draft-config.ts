import {
  HomepageSectionType,
  type HomepageDraftConfig,
} from '@bake-mall/contracts';

export const createBlankHomepageDraftConfig = (): HomepageDraftConfig => ({
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
    phone: '',
    serviceHours: '',
    wechatQrCode: null,
  },
  shortcutGrid: {
    id: 'shortcut-grid',
    type: HomepageSectionType.SHORTCUT_GRID,
    enabled: true,
    title: '快捷入口',
    layout: 4,
    items: [],
  },
  imageBlocks: [],
});
