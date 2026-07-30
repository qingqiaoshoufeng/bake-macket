import {
  HomepageInternalPage,
  HomepageLinkType,
  type HomepageAutoplayMs,
  type HomepageGridLayout,
} from '@bake-mall/contracts';

export const GRID_LAYOUT_OPTIONS: readonly HomepageGridLayout[] = [3, 4, 5, 6, 9];
export const AUTOPLAY_OPTIONS: readonly { label: string; value: HomepageAutoplayMs }[] = [
  { label: '关闭自动播放', value: 0 },
  { label: '3 秒', value: 3000 },
  { label: '5 秒', value: 5000 },
  { label: '8 秒', value: 8000 },
];
export const LINK_TYPE_OPTIONS = [
  { label: '无跳转', value: HomepageLinkType.NONE },
  { label: '商品', value: HomepageLinkType.PRODUCT },
  { label: '分类', value: HomepageLinkType.CATEGORY },
  { label: '商城页面', value: HomepageLinkType.PAGE },
] as const;
export const INTERNAL_PAGE_OPTIONS = [
  { label: '商品页', value: HomepageInternalPage.PRODUCTS },
  { label: '购物车', value: HomepageInternalPage.CART },
  { label: '订单', value: HomepageInternalPage.ORDERS },
  { label: '我的', value: HomepageInternalPage.PROFILE },
  { label: '会员卡', value: HomepageInternalPage.MEMBERSHIP_CARDS },
] as const;
