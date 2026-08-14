import { AdminPermission, AdminRole } from '@bake-mall/contracts';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';

import { useAdminAuthStore } from '../stores/admin-auth.js';

/**
 * Merchant admin route set locked by the design spec + Task 11:
 *
 * | Path          | Purpose                                      | Guard          |
 * |---------------|----------------------------------------------|----------------|
 * | `/login`      | single-super-admin credential sign-in        | public         |
 * | `/dashboard`  | KPI snapshot landing                         | admin auth     |
 * | `/categories` | category management (Task 12)                | admin auth     |
 * | `/products`   | product + SKU management (Task 12)           | admin auth     |
 * | `/banners`    | banner management (Task 12)                  | admin auth     |
 * | `/orders`     | order queue + state machine UI (Task 12)     | admin auth     |
 *
 * `/dashboard` / `/categories` / `/products` / `/banners` / `/orders` are
 * nested children of {@link AdminLayout} so the sidebar, topbar and mobile
 * narrow-screen hint wrap every authenticated view. Category management is
 * implemented by Task 12; the remaining Task 12 children still use
 * {@link PlaceholderView} until their own vertical slices are complete.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'admin-login',
    component: () => import('../views/LoginView.vue'),
  },
  {
    path: '/',
    component: () => import('../layouts/AdminLayout.vue'),
    meta: { requiresAdminAuth: true },
    children: [
      {
        path: '',
        redirect: { name: 'admin-dashboard' },
      },
      {
        path: 'dashboard',
        name: 'admin-dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: { layoutMode: 'document' },
      },
      {
        path: 'homepage',
        name: 'admin-homepage',
        component: () => import('../views/homepage/HomepageEditorView.vue'),
        meta: { title: '首页装修', layoutMode: 'workspace' },
      },
      {
        path: 'categories',
        name: 'admin-categories',
        component: () => import('../views/CategoriesView.vue'),
        meta: { layoutMode: 'workspace' },
      },
      {
        path: 'products',
        name: 'admin-products',
        component: () => import('../views/products/ProductsView.vue'),
        meta: { title: '商品管理', layoutMode: 'workspace' },
      },
      {
        path: 'products/new',
        name: 'admin-product-new',
        component: () => import('../views/products/ProductEditorView.vue'),
        meta: { title: '新建商品', layoutMode: 'document' },
      },
      {
        path: 'products/:id/edit',
        name: 'admin-product-edit',
        component: () => import('../views/products/ProductEditorView.vue'),
        meta: { title: '编辑商品', layoutMode: 'document' },
      },
      {
        path: 'banners',
        name: 'admin-banners',
        component: () => import('../views/banners/BannersView.vue'),
        meta: { title: '商品页 Banner', layoutMode: 'workspace' },
      },
      {
        path: 'orders',
        name: 'admin-orders',
        component: () => import('../views/orders/OrdersView.vue'),
        meta: {
          title: '订单管理',
          layoutMode: 'workspace',
          requiredPermission: AdminPermission.ORDER_READ,
        },
      },
      {
        path: 'users',
        name: 'admin-users',
        component: () => import('../views/users/UsersView.vue'),
        meta: {
          title: '用户管理',
          layoutMode: 'workspace',
          requiredPermission: AdminPermission.USER_READ,
        },
      },
      {
        path: 'printing/devices',
        name: 'admin-printing-devices',
        component: () =>
          import('../views/printing-devices/PrintingDevicesView.vue'),
        meta: {
          title: '打印设备',
          layoutMode: 'workspace',
          requiredPermission: AdminPermission.PRINT_DEVICE_MANAGE,
        },
      },
      {
        path: 'printing/batches',
        name: 'admin-printing-batches',
        component: () => import('../views/PlaceholderView.vue'),
        meta: {
          title: '打印记录',
          layoutMode: 'document',
          requiredPermission: AdminPermission.PRINT_HISTORY_READ,
        },
      },
      {
        path: 'admin-password',
        name: 'admin-password',
        component: () =>
          import('../views/admin-password/AdminPasswordView.vue'),
        meta: { title: '修改密码', layoutMode: 'document' },
      },
      {
        path: 'membership-cards',
        name: 'admin-membership-cards',
        component: () =>
          import('../views/membership-cards/MembershipCardsView.vue'),
        meta: { title: '会员卡配置', layoutMode: 'workspace' },
      },
      {
        path: 'membership-purchases',
        name: 'admin-membership-purchases',
        component: () =>
          import('../views/membership-purchases/MembershipPurchasesView.vue'),
        meta: { title: '购卡记录', layoutMode: 'workspace' },
      },
      {
        path: 'membership-cards/new',
        name: 'admin-membership-card-new',
        component: () =>
          import('../views/membership-cards/MembershipCardEditorView.vue'),
        meta: { title: '新建会员卡', layoutMode: 'document' },
      },
      {
        path: 'membership-cards/:id/edit',
        name: 'admin-membership-card-edit',
        component: () =>
          import('../views/membership-cards/MembershipCardEditorView.vue'),
        meta: { title: '编辑会员卡', layoutMode: 'document' },
      },
      {
        path: ':pathMatch(.*)*',
        name: 'admin-not-found',
        component: () => import('../views/NotFoundView.vue'),
        meta: { layoutMode: 'document' },
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/**
 * Global navigation guard:
 *
 * - Routes flagged `meta.requiresAdminAuth` (admin-shell children) delegate
 *   the redirect decision to {@link useAdminAuthStore.requireAdminAuth} so
 *   the same `/login?redirect=<encoded path>` shape is reused everywhere a
 *   public visitor tries to reach a protected page.
 * - Authenticated merchants hitting `/login` are bounced to the dashboard
 *   so the back button doesn't keep them on the sign-in form.
 */
router.beforeEach((to) => {
  const adminAuth = useAdminAuthStore();
  if (to.meta.requiresAdminAuth) {
    const target = adminAuth.requireAdminAuth(to.fullPath);
    if (target) return target;
    if (adminAuth.mustChangePassword && to.name !== 'admin-password') {
      return '/admin-password';
    }
    if (
      adminAuth.role === AdminRole.OPERATOR &&
      to.name !== 'admin-password' &&
      (to.name === 'admin-dashboard' ||
        !to.meta.requiredPermission ||
        !adminAuth.hasPermission(to.meta.requiredPermission))
    ) {
      return to.path === '/orders' ? true : '/orders';
    }
  }
  if (to.name === 'admin-login' && adminAuth.isAuthenticated) {
    if (adminAuth.mustChangePassword) return '/admin-password';
    const fallback =
      adminAuth.role === AdminRole.OPERATOR ? '/orders' : '/dashboard';
    const redirect =
      typeof to.query.redirect === 'string' ? to.query.redirect : fallback;
    return redirect.startsWith('/') ? redirect : fallback;
  }
  return true;
});

declare module 'vue-router' {
  interface RouteMeta {
    requiresAdminAuth?: boolean;
    title?: string;
    layoutMode?: 'workspace' | 'document';
    requiredPermission?: AdminPermission;
  }
}
