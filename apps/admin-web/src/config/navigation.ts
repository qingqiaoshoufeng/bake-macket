import {
  AdminPermission,
  AdminRole,
  type AdminSessionView,
} from '@bake-mall/contracts';

export interface AdminNavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
  readonly requiredPermission?: AdminPermission;
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
    items: [
      {
        path: '/orders',
        label: '订单',
        icon: 'order',
        requiredPermission: AdminPermission.ORDER_READ,
      },
    ],
  },
  {
    label: '用户管理',
    items: [
      {
        path: '/users',
        label: '用户',
        icon: 'user',
        requiredPermission: AdminPermission.USER_READ,
      },
    ],
  },
  {
    label: '打印管理',
    items: [
      {
        path: '/printing/devices',
        label: '打印设备',
        icon: 'printer',
        requiredPermission: AdminPermission.PRINT_DEVICE_MANAGE,
      },
      {
        path: '/printing/batches',
        label: '打印记录',
        icon: 'print-history',
        requiredPermission: AdminPermission.PRINT_HISTORY_READ,
      },
    ],
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

export function visibleAdminNavGroups(
  session: AdminSessionView | null,
): readonly AdminNavGroup[] {
  if (!session) return [];
  if (session.role === AdminRole.SUPER_ADMIN) return ADMIN_NAV_GROUPS;

  const permissions: readonly AdminPermission[] = session.permissions;
  return ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        item.requiredPermission !== undefined &&
        permissions.includes(item.requiredPermission),
    ),
  })).filter((group) => group.items.length > 0);
}
