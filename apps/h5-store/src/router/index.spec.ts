import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { router } from './index.js';

type LazyViewModule = {
  readonly default: { readonly __name?: string };
};

type LazyViewLoader = () => Promise<LazyViewModule>;

const expectedViews = [
  {
    path: '/',
    routeName: 'home',
    componentName: 'HomepageView',
    meta: { showTabbar: true, tabbarKey: 'home' },
  },
  {
    path: '/products',
    routeName: 'products',
    componentName: 'CatalogView',
    meta: { showTabbar: true, tabbarKey: 'products' },
  },
  {
    path: '/category/cake',
    routeName: 'category',
    componentName: 'CategoryView',
    meta: {},
  },
  {
    path: '/products/product-1',
    routeName: 'product-detail',
    componentName: 'ProductDetailView',
    meta: { showTabbar: true, tabbarKey: 'products' },
  },
  { path: '/cart', routeName: 'cart', componentName: 'CartView', meta: {} },
  {
    path: '/checkout',
    routeName: 'checkout',
    componentName: 'CheckoutView',
    meta: { requiresVerifiedPhone: true },
  },
  {
    path: '/orders',
    routeName: 'orders',
    componentName: 'OrdersView',
    meta: { requiresAuth: true },
  },
  {
    path: '/orders/order-1',
    routeName: 'order-detail',
    componentName: 'OrderDetailView',
    meta: { requiresAuth: true },
  },
  {
    path: '/profile',
    routeName: 'profile',
    componentName: 'ProfileView',
    meta: { requiresAuth: true },
  },
  {
    path: '/addresses',
    routeName: 'addresses',
    componentName: 'AddressesView',
    meta: { requiresAuth: true },
  },
  {
    path: '/membership-cards',
    routeName: 'membership-cards',
    componentName: 'MembershipCenterView',
    meta: { requiresAuth: true },
  },
  {
    path: '/membership-cards/level-1',
    routeName: 'membership-card-detail',
    componentName: 'MembershipDetailView',
    meta: { requiresVerifiedPhone: true },
  },
  {
    path: '/membership-purchases/purchase-1',
    routeName: 'membership-purchase-result',
    componentName: 'MembershipPurchaseResultView',
    meta: { requiresAuth: true },
  },
  {
    path: '/login',
    routeName: 'login',
    componentName: 'LoginView',
    meta: {},
  },
] as const;

describe('H5 routes', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it.each(expectedViews)(
    'loads $componentName for $path',
    async ({ path, routeName, componentName, meta }) => {
      const record = router
        .resolve(path)
        .matched.find((candidate) => candidate.name === routeName);
      const loader = record?.components?.default as LazyViewLoader | undefined;

      expect(typeof loader).toBe('function');
      expect((await loader?.())?.default.__name).toBe(componentName);
      expect(record?.meta).toMatchObject(meta);
    },
  );
});
