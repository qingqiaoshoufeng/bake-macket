import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';

import { useAuthStore } from '../stores/auth.js';

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
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/category/:id',
    name: 'category',
    component: () => import('../views/PlaceholderView.vue'),
  },
  {
    path: '/products/:id',
    name: 'product-detail',
    component: () => import('../views/PlaceholderView.vue'),
  },
  {
    path: '/cart',
    name: 'cart',
    component: () => import('../views/PlaceholderView.vue'),
  },
  {
    path: '/checkout',
    name: 'checkout',
    component: () => import('../views/PlaceholderView.vue'),
    meta: { requiresVerifiedPhone: true },
  },
  {
    path: '/orders',
    name: 'orders',
    component: () => import('../views/PlaceholderView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/orders/:id',
    name: 'order-detail',
    component: () => import('../views/PlaceholderView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../views/PlaceholderView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/addresses',
    name: 'addresses',
    component: () => import('../views/PlaceholderView.vue'),
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

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/**
 * Global navigation guard:
 *
 * - Routes marked `requiresAuth` bounce anonymous visitors to
 *   `/login?redirect=<encoded path>`.
 * - Routes marked `requiresVerifiedPhone` use
 *   {@link useAuthStore.requireVerifiedPhone} so the user gets the same
 *   redirect shape whether they are anonymous or simply unverified.
 */
router.beforeEach((to) => {
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

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    requiresVerifiedPhone?: boolean;
  }
}
