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
      { path: '/homepage', label: '首页装修', icon: 'homepage' },
      { path: '/categories', label: '分类', icon: 'category' },
      { path: '/products', label: '商品', icon: 'product' },
      { path: '/banners', label: '商品页 Banner', icon: 'banner' },
    ],
  },
  {
    label: '订单履约',
    items: [{ path: '/orders', label: '订单', icon: 'order' }],
  },
  {
    label: '会员运营',
    items: [
      { path: '/membership-cards', label: '会员卡配置', icon: 'membership' },
      {
        path: '/membership-purchases',
        label: '购卡记录',
        icon: 'membership-purchase',
      },
    ],
  },
];
