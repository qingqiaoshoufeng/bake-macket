import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type Router,
} from 'vue-router';

import { useAuthStore } from '../stores/auth.js';

export type RouterAuthDependencies = Readonly<{
  waitForCurrentAttempt: () => Promise<void>;
}>;

const settledAuthAttempt = Promise.resolve();

function waitForSettledAuthAttempt(): Promise<void> {
  return settledAuthAttempt;
}

/**
 * Application routes locked by the design spec:
 * `/`, `/category/:id`, `/products/:id`, `/cart`, `/checkout`,
 * `/orders`, `/orders/:id`, `/profile`, `/addresses`, `/login`.
 *
 * Catalog/cart/checkout/order/address/profile implementations land in Tasks
 * 9 / 10 — until then, the routes point at a shared {@link PlaceholderView}
 * so the navigation shell renders end-to-end.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/homepage/HomepageView.vue'),
    meta: { showTabbar: true, tabbarKey: 'home' },
  },
  {
    path: '/products',
    name: 'products',
    component: () => import('../views/catalog/CatalogView.vue'),
    meta: { showTabbar: true, tabbarKey: 'products' },
  },
  {
    path: '/category/:id',
    name: 'category',
    component: () => import('../views/CategoryView.vue'),
    meta: { showTabbar: true, tabbarKey: 'products' },
  },
  {
    path: '/products/:id',
    name: 'product-detail',
    component: () => import('../views/ProductDetailView.vue'),
    meta: { showTabbar: true, tabbarKey: 'products' },
  },
  {
    path: '/cart',
    name: 'cart',
    component: () => import('../views/CartView.vue'),
    meta: { showTabbar: true, tabbarKey: 'cart' },
  },
  {
    path: '/checkout',
    name: 'checkout',
    component: () => import('../views/CheckoutView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/orders',
    name: 'orders',
    component: () => import('../views/OrdersView.vue'),
    meta: { requiresAuth: true, showTabbar: true, tabbarKey: 'orders' },
  },
  {
    path: '/orders/:id',
    name: 'order-detail',
    component: () => import('../views/OrderDetailView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../views/ProfileView.vue'),
    meta: { requiresAuth: true, showTabbar: true, tabbarKey: 'profile' },
  },
  {
    path: '/addresses',
    name: 'addresses',
    component: () => import('../views/AddressesView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/membership-cards',
    name: 'membership-cards',
    component: () => import('../views/membership/MembershipCenterView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/membership-cards/:id',
    name: 'membership-card-detail',
    component: () => import('../views/membership/MembershipDetailView.vue'),
    meta: { requiresVerifiedPhone: true },
  },
  {
    path: '/membership-purchases/:id',
    name: 'membership-purchase-result',
    component: () =>
      import('../views/membership/MembershipPurchaseResultView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFoundView.vue'),
  },
];

export function createStoreRouter(
  dependencies: RouterAuthDependencies = {
    waitForCurrentAttempt: waitForSettledAuthAttempt,
  },
): Router {
  const router = createRouter({
    history: createWebHistory(),
    routes,
  });

  /**
   * Protected routes wait only for an already-running miniapp login exchange.
   * Public catalog routes remain renderable while WeChat authentication runs.
   */
  router.beforeEach(async (to) => {
    if (to.meta.requiresAuth || to.meta.requiresVerifiedPhone) {
      await dependencies.waitForCurrentAttempt();
    }
    const auth = useAuthStore();
    if (to.meta.requiresVerifiedPhone) {
      const target = auth.requireVerifiedPhone(to.fullPath);
      if (target) return target;
    }
    if (to.meta.requiresAuth && !auth.isAuthenticated) {
      return `/login?redirect=${encodeURIComponent(to.fullPath)}`;
    }
    return true;
  });

  return router;
}

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    requiresVerifiedPhone?: boolean;
    showTabbar?: boolean;
    tabbarKey?: 'home' | 'products' | 'cart' | 'orders' | 'profile';
  }
}
