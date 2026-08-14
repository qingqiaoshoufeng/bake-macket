import type { AdminPermission } from '@bake-mall/contracts';

import { ADMIN_NAVIGATION } from '../../admin/config/navigation.js';
import type { BakeMallAppData } from '../../app.js';

const app = getApp<BakeMallAppData>();

type NavigationItem = (typeof ADMIN_NAVIGATION)[number];

type AdminHomeData = Readonly<{
  navigation: readonly NavigationItem[];
}>;

type AdminHomeCustom = {
  onExit: () => void;
  onNavigate: (event: NavigationEvent) => void;
};

type NavigationEvent = Readonly<{
  currentTarget: Readonly<{ dataset: Readonly<{ route?: unknown }> }>;
}>;

function hasPermission(
  permissions: readonly AdminPermission[],
  permission: AdminPermission,
): boolean {
  return permissions.some((item) => item === permission);
}

Page<AdminHomeData, AdminHomeCustom>({
  data: {
    navigation: [],
  },

  onShow(): void {
    const session = app.adminSession.get();
    if (!session) {
      void wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    if (session.mustChangePassword) {
      void wx.redirectTo({ url: '/pages/admin-password/index' });
      return;
    }
    this.setData({
      navigation: ADMIN_NAVIGATION.filter((item) =>
        hasPermission(session.permissions, item.permission),
      ),
    });
  },

  onNavigate(event: NavigationEvent): void {
    const route = event.currentTarget.dataset.route;
    if (typeof route === 'string' && route.startsWith('/pages/')) {
      void wx.navigateTo({ url: route });
    }
  },

  onExit(): void {
    app.adminSession.clear();
    void wx.reLaunch({ url: '/pages/index/index' });
  },
});
