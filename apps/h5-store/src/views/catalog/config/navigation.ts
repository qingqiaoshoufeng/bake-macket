import { BannerTargetType, type BannerView } from '@bake-mall/contracts';

export function bannerTargetPath(banner: BannerView): string | null {
  if (banner.targetType === BannerTargetType.PRODUCT) {
    return `/products/${banner.targetId}`;
  }
  if (banner.targetType === BannerTargetType.CATEGORY) {
    return `/category/${banner.targetId}`;
  }
  return null;
}

export const STORE_NAV_ITEMS = [
  { key: 'home', label: '首页', path: '/', icon: 'wap-home-o' },
  { key: 'cart', label: '购物车', path: '/cart', icon: 'shopping-cart-o' },
  { key: 'orders', label: '订单', path: '/orders', icon: 'orders-o' },
  { key: 'profile', label: '我的', path: '/profile', icon: 'user-o' },
] as const;
