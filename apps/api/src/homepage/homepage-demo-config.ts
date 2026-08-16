import {
  HomepageInternalPage,
  HomepageLinkType,
  HomepageSectionType,
  type HomepageDraftConfig,
  type MediaAsset,
} from '@bake-mall/contracts';

import type {
  HomepageDemoAssetRole,
  LoadedHomepageDemoAsset,
} from './homepage-demo-fixture.js';

export type HomepageDemoAssetMap = ReadonlyMap<
  HomepageDemoAssetRole,
  MediaAsset
>;

export const homepageDemoObjectKey = (
  asset: Pick<LoadedHomepageDemoAsset, 'detected'> & {
    readonly manifest: Pick<LoadedHomepageDemoAsset['manifest'], 'fileName'>;
  },
): string =>
  `homepage/demo/v1/${asset.detected.sha256.slice(0, 12)}-${asset.manifest.fileName}`;

function requireAsset(
  assets: HomepageDemoAssetMap,
  role: HomepageDemoAssetRole,
): MediaAsset {
  const asset = assets.get(role);
  if (!asset) throw new Error(`首页示例缺少素材角色: ${role}`);
  return asset;
}

export function createHomepageDemoConfig(
  assets: HomepageDemoAssetMap,
): HomepageDraftConfig {
  return {
    schemaVersion: 1,
    hero: {
      id: 'hero',
      type: HomepageSectionType.HERO_CAROUSEL,
      enabled: true,
      autoplayMs: 5000,
      slides: [
        {
          id: 'hero-birthday',
          image: requireAsset(assets, 'hero-birthday'),
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
          image: requireAsset(assets, 'hero-afternoon-tea'),
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
      wechatQrCode: requireAsset(assets, 'customer-service-placeholder'),
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
          image: requireAsset(assets, 'shortcut-cake'),
          link: {
            type: HomepageLinkType.PAGE,
            page: HomepageInternalPage.PRODUCTS,
          },
        },
        {
          id: 'shortcut-bread',
          label: '每日面包',
          image: requireAsset(assets, 'shortcut-bread'),
          link: {
            type: HomepageLinkType.PAGE,
            page: HomepageInternalPage.PRODUCTS,
          },
        },
        {
          id: 'shortcut-gift',
          label: '心意礼盒',
          image: requireAsset(assets, 'shortcut-gift'),
          link: {
            type: HomepageLinkType.PAGE,
            page: HomepageInternalPage.MEMBERSHIP_CARDS,
          },
        },
        {
          id: 'shortcut-service',
          label: '联系客服',
          image: requireAsset(assets, 'shortcut-service'),
          link: { type: HomepageLinkType.NONE },
        },
      ],
    },
    imageBlocks: [
      {
        id: 'block-morning-bread',
        type: HomepageSectionType.IMAGE_BLOCK,
        enabled: true,
        image: requireAsset(assets, 'block-morning-bread'),
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
        image: requireAsset(assets, 'block-weekend-box'),
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
}
