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
 * narrow-screen hint wrap every authenticated view.
 * Categories/products/banners/orders children point at a shared
 * {@link PlaceholderView} until Task 12 replaces them with real feature views.
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
      },
      {
        path: 'categories',
        name: 'admin-categories',
        component: () => import('../views/PlaceholderView.vue'),
      },
      {
        path: 'products',
        name: 'admin-products',
        component: () => import('../views/PlaceholderView.vue'),
      },
      {
        path: 'banners',
        name: 'admin-banners',
        component: () => import('../views/PlaceholderView.vue'),
      },
      {
        path: 'orders',
        name: 'admin-orders',
        component: () => import('../views/PlaceholderView.vue'),
      },
      {
        path: ':pathMatch(.*)*',
        name: 'admin-not-found',
        component: () => import('../views/NotFoundView.vue'),
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
  }
  if (to.name === 'admin-login' && adminAuth.isAuthenticated) {
    const redirect =
      typeof to.query.redirect === 'string' ? to.query.redirect : '/dashboard';
    return redirect.startsWith('/') ? redirect : '/dashboard';
  }
  return true;
});

declare module 'vue-router' {
  interface RouteMeta {
    requiresAdminAuth?: boolean;
  }
}
