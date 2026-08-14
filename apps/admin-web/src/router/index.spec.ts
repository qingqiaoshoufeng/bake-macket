import {
  AdminPermission,
  AdminRole,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import CategoriesView from '../views/CategoriesView.vue';
import DashboardView from '../views/DashboardView.vue';
import NotFoundView from '../views/NotFoundView.vue';
import PlaceholderView from '../views/PlaceholderView.vue';
import OrderFlowGuide from '../views/dashboard/components/OrderFlowGuide.vue';
import { ORDER_FLOW } from '../views/dashboard/config/order-flow.js';
import { DASHBOARD_ENTRY_PREVIEW } from '../views/dashboard/mock/entries.mock.js';
import BannersView from '../views/banners/BannersView.vue';
import MembershipCardEditorView from '../views/membership-cards/MembershipCardEditorView.vue';
import MembershipCardsView from '../views/membership-cards/MembershipCardsView.vue';
import MembershipPurchasesView from '../views/membership-purchases/MembershipPurchasesView.vue';
import OrdersView from '../views/orders/OrdersView.vue';
import ProductEditorView from '../views/products/ProductEditorView.vue';
import PrintingDevicesView from '../views/printing-devices/PrintingDevicesView.vue';
import UsersView from '../views/users/UsersView.vue';
import ProductsView from '../views/products/ProductsView.vue';
import { useAdminAuthStore } from '../stores/admin-auth.js';
import { router } from './index.js';

type LazyViewModule = {
  readonly default: unknown;
};

type ExpectedLayoutMode = 'workspace' | 'document';

type LazyViewLoader = () => Promise<LazyViewModule>;

async function resolveView(component: unknown): Promise<unknown> {
  return typeof component === 'function'
    ? (await (component as LazyViewLoader)()).default
    : component;
}

const layoutCases = [
  ['/homepage', 'workspace'],
  ['/categories', 'workspace'],
  ['/products', 'workspace'],
  ['/banners', 'workspace'],
  ['/orders', 'workspace'],
  ['/users', 'workspace'],
  ['/membership-cards', 'workspace'],
  ['/membership-purchases', 'workspace'],
  ['/printing/devices', 'workspace'],
  ['/dashboard', 'document'],
  ['/products/new', 'document'],
  ['/products/product-1/edit', 'document'],
  ['/membership-cards/new', 'document'],
  ['/membership-cards/level-1/edit', 'document'],
  ['/missing', 'document'],
] as const satisfies readonly (readonly [string, ExpectedLayoutMode])[];

const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

const restrictedOperatorSession: AdminSessionView = {
  accessToken: 'restricted-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: [],
  mustChangePassword: true,
};

const superAdminSession: AdminSessionView = {
  accessToken: 'super-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.SUPER_ADMIN,
  permissions: SUPER_ADMIN_PERMISSIONS,
  mustChangePassword: false,
};

beforeEach(async () => {
  setActivePinia(createPinia());
  window.sessionStorage.clear();
  await router.replace('/login');
});

describe('admin permission routing', () => {
  it('assigns required shared permissions to operator routes', () => {
    expect(router.resolve('/orders').meta.requiredPermission).toBe(
      AdminPermission.ORDER_READ,
    );
    expect(router.resolve('/users').meta.requiredPermission).toBe(
      AdminPermission.USER_READ,
    );
    expect(router.resolve('/printing/devices').meta.requiredPermission).toBe(
      AdminPermission.PRINT_DEVICE_MANAGE,
    );
    expect(router.resolve('/printing/batches').meta.requiredPermission).toBe(
      AdminPermission.PRINT_HISTORY_READ,
    );
  });

  it.each(['/', '/dashboard'])(
    'redirects an operator from %s to orders',
    async (path) => {
      useAdminAuthStore().applySession(operatorSession, {
        identifier: '13800000000',
      });

      await router.push(path);

      expect(router.currentRoute.value.fullPath).toBe('/orders');
    },
  );

  it('redirects an operator without permission to orders without looping', async () => {
    useAdminAuthStore().applySession(operatorSession, {
      identifier: '13800000000',
    });

    await router.push('/products');
    expect(router.currentRoute.value.fullPath).toBe('/orders');
    await router.push('/orders');
    expect(router.currentRoute.value.fullPath).toBe('/orders');
  });

  it('forces must-change sessions to admin-password', async () => {
    useAdminAuthStore().applySession(restrictedOperatorSession, {
      identifier: '13800000000',
    });

    await router.push('/orders');

    expect(router.currentRoute.value.fullPath).toBe('/admin-password');
  });

  it('allows a complete session to visit ordinary password change', async () => {
    useAdminAuthStore().applySession(operatorSession, {
      identifier: '13800000000',
    });

    await router.push('/admin-password');

    expect(router.currentRoute.value.fullPath).toBe('/admin-password');
  });

  it('allows an OPERATOR with PRINT_DEVICE_MANAGE to visit printing devices', async () => {
    useAdminAuthStore().applySession(operatorSession, {
      identifier: '13800000000',
    });

    await router.push('/printing/devices');

    expect(router.currentRoute.value.fullPath).toBe('/printing/devices');
  });

  it('keeps the complete route set available to SUPER_ADMIN', async () => {
    useAdminAuthStore().applySession(superAdminSession, {
      identifier: 'admin@example.com',
    });

    await router.push('/products');

    expect(router.currentRoute.value.fullPath).toBe('/products');
  });
});

describe('admin route layout modes', () => {
  it.each(layoutCases)('resolves %s with %s layout', (path, layoutMode) => {
    expect(router.resolve(path).meta.layoutMode).toBe(layoutMode);
  });
});

describe('admin category route', () => {
  it('lazy-loads the real category management view', async () => {
    const categoryRecord = router
      .resolve('/categories')
      .matched.find((record) => record.name === 'admin-categories');
    const component = categoryRecord?.components?.default;

    expect(await resolveView(component)).toBe(CategoriesView);
  });
});

describe('admin Banner route', () => {
  it('lazy-loads the protected Banner management view', async () => {
    const resolved = router.resolve('/banners');
    const routeRecord = resolved.matched.find(
      (record) => record.name === 'admin-banners',
    );
    const component = routeRecord?.components?.default;

    expect(resolved.meta.requiresAdminAuth).toBe(true);
    expect(resolved.meta.title).toBe('商品页 Banner');
    expect(typeof component).toBe('function');
    expect(await resolveView(component)).toBe(BannersView);
  });
});

describe('admin order route', () => {
  it('lazy-loads the protected order management view', async () => {
    const resolved = router.resolve('/orders');
    const routeRecord = resolved.matched.find(
      (record) => record.name === 'admin-orders',
    );
    const component = routeRecord?.components?.default;

    expect(resolved.meta.requiresAdminAuth).toBe(true);
    expect(resolved.meta.title).toBe('订单管理');
    expect(await resolveView(component)).toBe(OrdersView);
  });
});

describe('admin users route', () => {
  it('lazy-loads the protected real user management view', async () => {
    const resolved = router.resolve('/users');
    const routeRecord = resolved.matched.find(
      (record) => record.name === 'admin-users',
    );
    const component = routeRecord?.components?.default;

    expect(resolved.meta.requiresAdminAuth).toBe(true);
    expect(resolved.meta.requiredPermission).toBe(AdminPermission.USER_READ);
    expect(resolved.meta.title).toBe('用户管理');
    expect(await resolveView(component)).toBe(UsersView);
  });
});

describe('admin printing devices route', () => {
  it('lazy-loads the protected real printing device management view without replacing future printing routes', async () => {
    const devices = router.resolve('/printing/devices');
    const devicesRecord = devices.matched.find(
      (record) => record.name === 'admin-printing-devices',
    );
    const batches = router.resolve('/printing/batches');

    expect(devices.meta.requiresAdminAuth).toBe(true);
    expect(devices.meta.requiredPermission).toBe(
      AdminPermission.PRINT_DEVICE_MANAGE,
    );
    expect(devices.meta.title).toBe('打印设备');
    expect(devices.meta.layoutMode).toBe('workspace');
    expect(await resolveView(devicesRecord?.components?.default)).toBe(
      PrintingDevicesView,
    );
    expect(batches.name).toBe('admin-printing-batches');
    expect(batches.meta.requiredPermission).toBe(
      AdminPermission.PRINT_HISTORY_READ,
    );
  });
});

describe('admin membership card routes', () => {
  it.each([
    [
      '/membership-cards',
      'admin-membership-cards',
      '会员卡配置',
      MembershipCardsView,
    ],
    [
      '/membership-cards/new',
      'admin-membership-card-new',
      '新建会员卡',
      MembershipCardEditorView,
    ],
    [
      '/membership-cards/level-1/edit',
      'admin-membership-card-edit',
      '编辑会员卡',
      MembershipCardEditorView,
    ],
  ])(
    'resolves %s to a protected real view',
    async (path, name, title, view) => {
      const resolved = router.resolve(path);
      const routeRecord = resolved.matched.find(
        (record) => record.name === name,
      );
      const component = routeRecord?.components?.default;

      expect(resolved.meta.requiresAdminAuth).toBe(true);
      expect(resolved.meta.title).toBe(title);
      expect(await resolveView(component)).toBe(view);
    },
  );
});

describe('admin membership purchase route', () => {
  it('lazy-loads the protected purchase records view', async () => {
    const resolved = router.resolve('/membership-purchases');
    const routeRecord = resolved.matched.find(
      (record) => record.name === 'admin-membership-purchases',
    );
    const component = routeRecord?.components?.default;

    expect(resolved.meta.requiresAdminAuth).toBe(true);
    expect(resolved.meta.title).toBe('购卡记录');
    expect(await resolveView(component)).toBe(MembershipPurchasesView);
  });
});

describe('admin product routes', () => {
  it.each([
    ['/products', 'admin-products', '商品管理', ProductsView],
    ['/products/new', 'admin-product-new', '新建商品', ProductEditorView],
    [
      '/products/product-1/edit',
      'admin-product-edit',
      '编辑商品',
      ProductEditorView,
    ],
  ])(
    'resolves %s to a protected real view',
    async (path, name, title, view) => {
      const resolved = router.resolve(path);
      const routeRecord = resolved.matched.find(
        (record) => record.name === name,
      );
      const component = routeRecord?.components?.default;

      expect(resolved.name).toBe(name);
      expect(resolved.meta.requiresAdminAuth).toBe(true);
      expect(resolved.meta.title).toBe(title);
      expect(await resolveView(component)).toBe(view);
    },
  );
});

describe('admin branded entry and state pages', () => {
  it('renders a dashboard with real navigation entries and no placeholder KPI copy', async () => {
    const dashboardRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/dashboard', component: DashboardView },
        {
          path: '/categories',
          component: { template: '<div>categories</div>' },
        },
        { path: '/products', component: { template: '<div>products</div>' } },
        { path: '/banners', component: { template: '<div>banners</div>' } },
        { path: '/orders', component: { template: '<div>orders</div>' } },
      ],
    });
    await dashboardRouter.push('/dashboard');
    await dashboardRouter.isReady();

    const wrapper = mount(DashboardView, {
      global: { plugins: [dashboardRouter] },
    });

    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="dashboard-entry"]')).toHaveLength(4);
    expect(wrapper.text()).toContain('NEW');
    expect(wrapper.text()).toContain('PROCESSING');
    expect(wrapper.text()).toContain('COMPLETED');
    expect(wrapper.text()).toContain('CANCELLED');
    expect(wrapper.text()).not.toMatch(/Task 11|Task 12|占位提示|伪统计/);
  });

  it('routes every real dashboard entry to its configured feature', async () => {
    const routes = ['/orders', '/products', '/categories', '/banners'] as const;

    await Promise.all(
      routes.map(async (path, index) => {
        const dashboardRouter = createRouter({
          history: createMemoryHistory(),
          routes: [
            { path: '/dashboard', component: DashboardView },
            { path, component: { template: `<div>${path}</div>` } },
          ],
        });
        await dashboardRouter.push('/dashboard');
        await dashboardRouter.isReady();
        const wrapper = mount(DashboardView, {
          global: { plugins: [dashboardRouter] },
        });

        const entry = wrapper.findAll('[data-testid="dashboard-entry"]')[index];
        expect(entry.text()).toContain(DASHBOARD_ENTRY_PREVIEW[index].title);
        await entry.trigger('click');
        await flushPromises();
        expect(dashboardRouter.currentRoute.value.fullPath).toBe(path);
      }),
    );
  });

  it('renders NEW to PROCESSING before the completed or cancelled branch', () => {
    const wrapper = mount(OrderFlowGuide, {
      props: { flow: ORDER_FLOW },
    });

    expect(
      wrapper
        .findAll('[data-flow-stage]')
        .map((node) => node.attributes('data-flow-stage')),
    ).toEqual(['NEW', 'PROCESSING', 'OUTCOMES']);
    expect(wrapper.get('[data-flow-stage="OUTCOMES"]').text()).toContain(
      'COMPLETED',
    );
    expect(wrapper.get('[data-flow-stage="OUTCOMES"]').text()).toContain(
      'CANCELLED',
    );
    expect(wrapper.find('.order-flow-step__marker').exists()).toBe(false);
  });

  it('uses the shared empty state and preserves dashboard navigation', async () => {
    const stateRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/missing', component: NotFoundView },
        { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
      ],
    });
    await stateRouter.push('/missing');
    await stateRouter.isReady();

    const wrapper = mount(NotFoundView, {
      global: { plugins: [stateRouter] },
    });

    expect(wrapper.find('.admin-empty-state').exists()).toBe(true);
    await wrapper.get('[data-testid="not-found-home"]').trigger('click');
    await flushPromises();
    expect(stateRouter.currentRoute.value.fullPath).toBe('/dashboard');
  });

  it('keeps Placeholder navigation back to the dashboard', async () => {
    const stateRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/preview', component: PlaceholderView },
        { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
      ],
    });
    await stateRouter.push('/preview');
    await stateRouter.isReady();

    const wrapper = mount(PlaceholderView, {
      global: { plugins: [stateRouter] },
    });

    expect(wrapper.find('.admin-empty-state').exists()).toBe(true);
    await wrapper.get('[data-testid="placeholder-home"]').trigger('click');
    await flushPromises();
    expect(stateRouter.currentRoute.value.fullPath).toBe('/dashboard');
  });
});
