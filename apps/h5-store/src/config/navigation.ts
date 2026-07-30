export const STORE_NAV_ITEMS = [
  { key: 'home', label: '首页', path: '/', icon: 'wap-home-o' },
  { key: 'products', label: '商品', path: '/products', icon: 'shop-o' },
  { key: 'cart', label: '购物车', path: '/cart', icon: 'shopping-cart-o' },
  { key: 'orders', label: '订单', path: '/orders', icon: 'orders-o' },
  { key: 'profile', label: '我的', path: '/profile', icon: 'user-o' },
] as const;

export type StoreTabbarKey = (typeof STORE_NAV_ITEMS)[number]['key'];
