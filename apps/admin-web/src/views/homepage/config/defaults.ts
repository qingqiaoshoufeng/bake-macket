import {
  HomepageLinkType,
  HomepageSectionType,
  type HomepageDraftConfig,
  type HomepageGridLayout,
  type HomepageImageBlockSection,
  type HomepageShortcutItem,
} from '@bake-mall/contracts';

import { cloneJson } from '../../../utils/json.js';
import { createSecureUuidV4 } from '../../../utils/random-uuid.js';

const id = (prefix: string): string => `${prefix}-${createSecureUuidV4()}`;

export const createEmptyLink = () => ({ type: HomepageLinkType.NONE }) as const;

export const createShortcutItem = (): HomepageShortcutItem<null> => ({
  id: id('shortcut'),
  label: '',
  image: null,
  link: createEmptyLink(),
});

export const createImageBlock = (): HomepageImageBlockSection<null> => ({
  id: id('image-block'),
  type: HomepageSectionType.IMAGE_BLOCK,
  enabled: true,
  image: null,
  title: '',
  description: '',
  altText: '',
  link: createEmptyLink(),
});

export const resizeShortcutItems = (
  items: HomepageDraftConfig['shortcutGrid']['items'],
  layout: HomepageGridLayout,
): HomepageDraftConfig['shortcutGrid']['items'] =>
  Array.from({ length: layout }, (_, index) =>
    items[index] ? cloneJson(items[index]) : createShortcutItem(),
  );

export const createHomepageDraft = (): HomepageDraftConfig => ({
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
    description: '如需定制蛋糕或帮助，欢迎联系我们',
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
    items: resizeShortcutItems([], 4),
  },
  imageBlocks: [],
});
