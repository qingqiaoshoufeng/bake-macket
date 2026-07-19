export interface AdminNavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
}

export interface AdminNavGroup {
  readonly label: string;
  readonly items: readonly AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    label: '经营概览',
    items: [{ path: '/dashboard', label: '概览', icon: 'overview' }],
  },
  {
    label: '商品运营',
    items: [
      { path: '/categories', label: '分类', icon: 'category' },
      { path: '/products', label: '商品', icon: 'product' },
      { path: '/banners', label: 'Banner', icon: 'banner' },
    ],
  },
  {
    label: '订单履约',
    items: [{ path: '/orders', label: '订单', icon: 'order' }],
  },
];
