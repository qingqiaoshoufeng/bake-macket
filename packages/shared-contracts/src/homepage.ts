import type { MediaAsset } from './media.js';

export enum HomepageSectionType {
  HERO_CAROUSEL = 'HERO_CAROUSEL',
  CUSTOMER_SERVICE = 'CUSTOMER_SERVICE',
  SHORTCUT_GRID = 'SHORTCUT_GRID',
  IMAGE_BLOCK = 'IMAGE_BLOCK',
}

export enum HomepageLinkType {
  NONE = 'NONE',
  PRODUCT = 'PRODUCT',
  CATEGORY = 'CATEGORY',
  PAGE = 'PAGE',
}

export enum HomepageInternalPage {
  PRODUCTS = 'PRODUCTS',
  CART = 'CART',
  ORDERS = 'ORDERS',
  PROFILE = 'PROFILE',
  MEMBERSHIP_CARDS = 'MEMBERSHIP_CARDS',
}

export type HomepageLink =
  | { type: HomepageLinkType.NONE; targetId?: never; page?: never }
  | { type: HomepageLinkType.PRODUCT; targetId: string; page?: never }
  | { type: HomepageLinkType.CATEGORY; targetId: string; page?: never }
  | { type: HomepageLinkType.PAGE; page: HomepageInternalPage; targetId?: never };

export type HomepageGridLayout = 3 | 4 | 5 | 6 | 9;
export type HomepageAutoplayMs = 0 | 3000 | 5000 | 8000;

export type HomepageHeroSlide<TImage> = {
  id: string;
  image: TImage;
  title: string;
  subtitle: string;
  altText: string;
  link: HomepageLink;
};

export type HomepageHeroSection<TImage> = {
  id: string;
  type: HomepageSectionType.HERO_CAROUSEL;
  enabled: boolean;
  autoplayMs: HomepageAutoplayMs;
  slides: readonly HomepageHeroSlide<TImage>[];
};

export type HomepageCustomerServiceSection<TImage> = {
  id: string;
  type: HomepageSectionType.CUSTOMER_SERVICE;
  enabled: boolean;
  title: string;
  description: string;
  phone: string;
  serviceHours: string;
  wechatQrCode: TImage;
};

export type HomepageShortcutItem<TImage> = {
  id: string;
  label: string;
  image: TImage;
  link: HomepageLink;
};

export type HomepageShortcutGridSection<TImage> = {
  id: string;
  type: HomepageSectionType.SHORTCUT_GRID;
  enabled: boolean;
  title: string;
  layout: HomepageGridLayout;
  items: readonly HomepageShortcutItem<TImage>[];
};

export type HomepageImageBlockSection<TImage> = {
  id: string;
  type: HomepageSectionType.IMAGE_BLOCK;
  enabled: boolean;
  image: TImage;
  title: string;
  description: string;
  altText: string;
  link: HomepageLink;
};

export type HomepageConfig<TImage> = {
  schemaVersion: 1;
  hero: HomepageHeroSection<TImage>;
  customerService: HomepageCustomerServiceSection<TImage>;
  shortcutGrid: HomepageShortcutGridSection<TImage>;
  imageBlocks: readonly HomepageImageBlockSection<TImage>[];
};

export type HomepageDraftConfig = HomepageConfig<MediaAsset | null>;
export type HomepagePublishedConfig = HomepageConfig<MediaAsset>;
export type PublicHomepageConfig = HomepageConfig<{ imageUrl: string }>;

export type HomepageValidationIssue = {
  code: string;
  message: string;
  sectionId: string;
  itemId?: string;
  field?: string;
};

export type AdminHomepageView = {
  id: string;
  pageKey: 'HOME';
  draftConfig: HomepageDraftConfig;
  publishedConfig: HomepagePublishedConfig | null;
  version: number;
  publishedVersion?: number;
  draftUpdatedByAdminId?: string;
  draftUpdatedAt?: string;
  publishedByAdminId?: string;
  publishedAt?: string;
  draftIssues: readonly HomepageValidationIssue[];
};

export type SaveHomepageDraftRequest = {
  config: HomepageDraftConfig;
  version: number;
};

export type PublishHomepageRequest = {
  version: number;
};

export type PublicHomepageView = {
  config: PublicHomepageConfig;
  publishedVersion: number;
  publishedAt: string;
};
