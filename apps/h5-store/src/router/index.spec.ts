import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useAuthStore } from '../stores/auth.js';
import { createStoreRouter } from './index.js';

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
    meta: { requiresAuth: true },
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
  const router = createStoreRouter();

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

  it('等待正在进行的微信登录后允许未绑定手机号的顾客进入 checkout', async () => {
    let completeLogin!: () => void;
    const waitForCurrentAttempt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeLogin = () => {
            const auth = useAuthStore();
            auth.accessToken = 'wechat-token';
            auth.profile = {
              id: 'u1',
              phoneVerified: false,
              orderContactPhone: {
                configured: false,
                maskedPhone: null,
                version: 0,
              },
            };
            resolve();
          };
        }),
    );
    const guardedRouter = createStoreRouter({ waitForCurrentAttempt });

    const navigation = guardedRouter.push('/checkout');
    await vi.waitFor(() =>
      expect(waitForCurrentAttempt).toHaveBeenCalledOnce(),
    );
    expect(guardedRouter.currentRoute.value.path).not.toBe('/checkout');
    completeLogin();
    await navigation;

    expect(guardedRouter.currentRoute.value.path).toBe('/checkout');
  });

  it('微信登录失败后把匿名顾客送到带安全 redirect 的登录页', async () => {
    const guardedRouter = createStoreRouter({
      waitForCurrentAttempt: () => Promise.resolve(),
    });

    await guardedRouter.push('/checkout');

    expect(guardedRouter.currentRoute.value.fullPath).toBe(
      '/login?redirect=/checkout',
    );
  });

  it('公开首页不等待微信登录，会员购买仍要求已验证手机号', async () => {
    const waitForCurrentAttempt = vi.fn(
      () => new Promise<void>(() => undefined),
    );
    const guardedRouter = createStoreRouter({ waitForCurrentAttempt });

    await guardedRouter.push('/');
    expect(guardedRouter.currentRoute.value.path).toBe('/');
    expect(waitForCurrentAttempt).not.toHaveBeenCalled();

    const auth = useAuthStore();
    auth.accessToken = 'wechat-token';
    auth.profile = {
      id: 'u1',
      phoneVerified: false,
      orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
    };
    const membershipRouter = createStoreRouter({
      waitForCurrentAttempt: () => Promise.resolve(),
    });
    await membershipRouter.push('/membership-cards/level-1');
    expect(membershipRouter.currentRoute.value.path).toBe('/login');
  });
});
