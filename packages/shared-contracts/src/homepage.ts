import type { PaginatedView } from './admin-list.js';
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
  | {
      type: HomepageLinkType.PAGE;
      page: HomepageInternalPage;
      targetId?: never;
    };

export type HomepageDraftLink = HomepageLink;

export const HomepageDraftStatus = {
  PUBLISHED: 'PUBLISHED',
  PUBLISHED_WITH_CHANGES: 'PUBLISHED_WITH_CHANGES',
  DRAFT: 'DRAFT',
} as const;

export type HomepageDraftStatus =
  (typeof HomepageDraftStatus)[keyof typeof HomepageDraftStatus];

export type HomepageGridLayout = 3 | 4 | 5 | 6 | 9;
export type HomepageAutoplayMs = 0 | 3000 | 5000 | 8000;

type TupleOf<
  TValue,
  TLength extends number,
  TItems extends readonly TValue[] = readonly [],
> = TItems['length'] extends TLength
  ? TItems
  : TupleOf<TValue, TLength, readonly [...TItems, TValue]>;

type TuplesOfLengths<TValue, TLength extends number> = TLength extends TLength
  ? TupleOf<TValue, TLength>
  : never;

type LengthFromZeroToNine = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type LengthFromZeroToTen = LengthFromZeroToNine | 10;
type LengthFromOneToTen = Exclude<LengthFromZeroToTen, 0>;
type LengthFromZeroToTwelve = LengthFromZeroToTen | 11 | 12;

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

export type HomepageSection<TImage> =
  | HomepageHeroSection<TImage>
  | HomepageCustomerServiceSection<TImage>
  | HomepageShortcutGridSection<TImage>
  | HomepageImageBlockSection<TImage>;

/** 固定区块顺序由属性位置表达：首屏轮播、客服、快捷入口、配图区。 */
export type HomepageConfig<TImage> = {
  schemaVersion: 1;
  hero: HomepageHeroSection<TImage>;
  customerService: HomepageCustomerServiceSection<TImage>;
  shortcutGrid: HomepageShortcutGridSection<TImage>;
  imageBlocks: readonly HomepageImageBlockSection<TImage>[];
};

export type HomepageDraftHeroSlide = {
  id: string;
  image: MediaAsset | null;
  title: string;
  subtitle: string;
  altText: string;
  link: HomepageDraftLink;
};

export type HomepageDraftHeroSection = {
  id: string;
  type: HomepageSectionType.HERO_CAROUSEL;
  enabled: boolean;
  autoplayMs: HomepageAutoplayMs;
  slides: readonly HomepageDraftHeroSlide[];
};

export type HomepageDraftCustomerServiceSection = {
  id: string;
  type: HomepageSectionType.CUSTOMER_SERVICE;
  enabled: boolean;
  title: string;
  description: string;
  phone: string;
  serviceHours: string;
  wechatQrCode: MediaAsset | null;
};

export type HomepageDraftShortcutItem = {
  id: string;
  label: string;
  image: MediaAsset | null;
  link: HomepageDraftLink;
};

export type HomepageDraftShortcutGridSection = {
  id: string;
  type: HomepageSectionType.SHORTCUT_GRID;
  enabled: boolean;
  title: string;
  layout: HomepageGridLayout;
  items: readonly HomepageDraftShortcutItem[];
};

export type HomepageDraftImageBlockSection = {
  id: string;
  type: HomepageSectionType.IMAGE_BLOCK;
  enabled: boolean;
  image: MediaAsset | null;
  title: string;
  description: string;
  altText: string;
  link: HomepageDraftLink;
};

export type HomepageDraftSection =
  | HomepageDraftHeroSection
  | HomepageDraftCustomerServiceSection
  | HomepageDraftShortcutGridSection
  | HomepageDraftImageBlockSection;

export type HomepageDraftConfig = {
  schemaVersion: 1;
  hero: HomepageDraftHeroSection;
  customerService: HomepageDraftCustomerServiceSection;
  shortcutGrid: HomepageDraftShortcutGridSection;
  imageBlocks: readonly HomepageDraftImageBlockSection[];
};

export type HomepagePublishedHeroSection<TImage> = Omit<
  HomepageHeroSection<TImage>,
  'slides'
> & {
  slides: TuplesOfLengths<HomepageHeroSlide<TImage>, LengthFromOneToTen>;
};

export type HomepagePublishedShortcutGridSection<TImage> = {
  readonly [TLayout in HomepageGridLayout]: Omit<
    HomepageShortcutGridSection<TImage>,
    'layout' | 'items'
  > & {
    layout: TLayout;
    items: TupleOf<HomepageShortcutItem<TImage>, TLayout>;
  };
}[HomepageGridLayout];

export type HomepageCompleteConfig<TImage> = Omit<
  HomepageConfig<TImage>,
  'hero' | 'shortcutGrid' | 'imageBlocks'
> & {
  hero: HomepagePublishedHeroSection<TImage>;
  shortcutGrid: HomepagePublishedShortcutGridSection<TImage>;
  imageBlocks: TuplesOfLengths<
    HomepageImageBlockSection<TImage>,
    LengthFromZeroToTwelve
  >;
};

export type HomepagePublishedConfig = HomepageCompleteConfig<MediaAsset>;
export type PublicHomepageConfig = HomepageConfig<{ imageUrl: string }>;

export type HomepageValidationIssue = {
  code: string;
  message: string;
  sectionId: string;
  itemId?: string;
  field?: string;
};

export type AdminHomepageDraftSummary = {
  id: string;
  name: string;
  status: HomepageDraftStatus;
  version: number;
  updatedByAdminId?: string;
  updatedAt: string;
  createdAt: string;
};

export type AdminHomepageDraftListView =
  PaginatedView<AdminHomepageDraftSummary> & {
    publishedDraftId?: string;
  };

export type CreateHomepageDraftRequest =
  | { name: string; mode: 'COPY'; sourceDraftId: string }
  | { name: string; mode: 'BLANK'; sourceDraftId?: never };

export type RenameHomepageDraftRequest = {
  name: string;
  version: number;
};

export type AdminHomepageView = {
  id: string;
  pageKey: 'HOME';
  name: string;
  status: HomepageDraftStatus;
  draftConfig: HomepageDraftConfig;
  version: number;
  updatedByAdminId?: string;
  updatedAt: string;
  createdAt: string;
  publishedVersion?: number;
  publishedAt?: string;
  /** 当前草稿的发布校验问题；为空时草稿满足发布条件。 */
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
