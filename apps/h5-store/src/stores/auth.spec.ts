import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import {
  FulfillmentType,
  OrderStatus,
  type AddressView,
  type CartItemView,
  type CustomerAuthSessionView,
  type OrderView,
} from '@bake-mall/contracts';

import { useCart } from '../views/cart/hooks/useCart.js';
import { useAddressesStore } from './addresses.js';
import { useAuthStore } from './auth.js';
import { useCartStore } from './cart.js';
import { useOrdersStore } from './orders.js';

/**
 * Pinia auth-store contract pinned by Task 8.
 *
 * - `requireVerifiedPhone(path)` returns a `/login?redirect=<encoded path>`
 *   target whenever the user lacks a verified phone; the consumer is a
 *   router navigation guard that should never re-checkout when the user is
 *   anonymous or unverified.
 * - `applySession(session, profile)` persists state produced by the login
 *   feature hook; the store owns state/application only and never performs
 *   feature network requests itself.
 */

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the login redirect when the verified phone is absent', () => {
    const store = useAuthStore();
    store.profile = {
      id: 'u1',
      phone: undefined,
      nickname: 'Cake Fan',
      avatarUrl: undefined,
      phoneVerified: false,
      orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
    };
    expect(store.requireVerifiedPhone('/checkout')).toBe(
      '/login?redirect=%2Fcheckout',
    );
  });

  it('returns null when the verified phone is present', () => {
    const store = useAuthStore();
    store.profile = {
      id: 'u1',
      phone: '13800000000',
      nickname: 'Cake Fan',
      avatarUrl: undefined,
      phoneVerified: true,
      orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
    };
    expect(store.requireVerifiedPhone('/checkout')).toBeNull();
  });

  it('resets user-domain caches when the account changes and refreshes before the new account adds', async () => {
    const auth = useAuthStore();
    const cartStore = useCartStore();
    const addresses = useAddressesStore();
    const orders = useOrdersStore();
    const cartItem = {
      id: 'cart-a',
      quantity: 5,
      available: true,
      sku: {
        id: 'sku-1',
        name: '6寸',
        attributes: {},
        priceCents: 6800,
        stock: 10,
        imageUrl: null,
        isActive: true,
      },
      product: {
        id: 'product-1',
        name: '草莓蛋糕',
        coverImageUrl: null,
        isActive: true,
      },
    } satisfies CartItemView;
    const address = {
      id: 'address-a',
      recipient: '账号A',
      phone: '13800000000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail: 'A 地址',
      isDefault: true,
    } satisfies AddressView;
    const order = {
      id: 'order-a',
      orderNo: 'BM-A',
      status: OrderStatus.NEW,
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '账号A',
      contactPhone: '13800000000',
      pickupTimeText: '明天',
      goodsTotalCents: 6800,
      membershipDiscountCents: 0,
      creditAppliedCents: 0,
      payableTotalCents: 6800,
      pricingVersion: 1,
      items: [],
      createdAt: '2026-07-19T10:00:00.000Z',
      updatedAt: '2026-07-19T10:00:00.000Z',
    } satisfies OrderView;

    auth.applySession(
      { accessToken: 'token-a', expiresAt: '2026-07-20T00:00:00.000Z' },
      {
        id: 'user-a',
        phone: '13800000000',
        phoneVerified: true,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      },
    );
    cartStore.applyItems([cartItem]);
    cartStore.setLoading(true);
    cartStore.setError('A cart error');
    addresses.applyItems([address]);
    addresses.setLoading(true);
    addresses.setSaving(true);
    addresses.setError('A address error');
    orders.applyItems([order]);
    orders.applyCurrent(order);
    orders.setLoading(true);
    orders.setSubmitting(true);
    orders.setError('A order error');

    auth.clearSession();
    auth.applySession(
      { accessToken: 'token-b', expiresAt: '2026-07-20T00:00:00.000Z' },
      {
        id: 'user-b',
        phone: '13900000000',
        phoneVerified: true,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      },
    );

    expect(cartStore.$state).toMatchObject({
      items: [],
      hydrated: false,
      loading: false,
      lastError: null,
    });
    expect(addresses.$state).toMatchObject({
      items: [],
      loading: false,
      saving: false,
      lastError: null,
    });
    expect(orders.$state).toMatchObject({
      items: [],
      current: null,
      loading: false,
      submitting: false,
      lastError: null,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...cartItem, id: 'cart-b', quantity: 1 }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await useCart().methods.add({ skuId: 'sku-1', quantity: 1 });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe(
      'GET',
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      skuId: 'sku-1',
      quantity: 1,
    });
  });

  it('does not reset user-domain caches when hydrating the same session without restricted runtime APIs', () => {
    const originalHasOwn = Object.hasOwn;
    const originalStructuredClone = globalThis.structuredClone;
    Object.defineProperty(Object, 'hasOwn', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: undefined,
    });
    window.localStorage.setItem('bake_user_token', 'same-token');
    window.localStorage.setItem(
      'bake_user_profile',
      JSON.stringify({
        id: 'user-a',
        phoneVerified: true,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      }),
    );
    const auth = useAuthStore();
    auth.applySession(
      { accessToken: 'same-token', expiresAt: '2026-07-20T00:00:00.000Z' },
      {
        id: 'user-a',
        phoneVerified: true,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      },
    );
    const cart = useCartStore();
    cart.applyItems([
      {
        id: 'cart-a',
        quantity: 2,
        available: true,
        sku: {
          id: 'sku-1',
          name: '6寸',
          attributes: {},
          priceCents: 6800,
          stock: 10,
          imageUrl: null,
          isActive: true,
        },
        product: {
          id: 'product-1',
          name: '草莓蛋糕',
          coverImageUrl: null,
          isActive: true,
        },
      },
    ]);

    try {
      auth.hydrate();

      expect(cart.items).toHaveLength(1);
      expect(cart.hydrated).toBe(true);
    } finally {
      Object.defineProperty(Object, 'hasOwn', {
        configurable: true,
        value: originalHasOwn,
      });
      Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        value: originalStructuredClone,
      });
    }
  });

  it('原子应用并持久化完整顾客 session', () => {
    const store = useAuthStore();
    const session = {
      accessToken: 'canonical-token',
      expiresAt: '2026-08-07T00:00:00.000Z',
      profile: {
        id: 'canonical-user',
        nickname: '微信顾客',
        avatarUrl: undefined,
        phone: '138****0000',
        phoneVerified: true,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      },
    } satisfies CustomerAuthSessionView;

    store.applyCustomerSession(session);

    expect(store.$state).toEqual({
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      profile: session.profile,
    });
    expect(window.localStorage.getItem('bake_user_token')).toBe(
      session.accessToken,
    );
    expect(window.localStorage.getItem('bake_user_expires_at')).toBe(
      session.expiresAt,
    );
    expect(window.localStorage.getItem('bake_user_profile')).toBe(
      JSON.stringify(session.profile),
    );

    store.clearSession();

    expect(store.$state).toEqual({
      accessToken: null,
      expiresAt: null,
      profile: null,
    });
    expect(window.localStorage.getItem('bake_user_token')).toBeNull();
    expect(window.localStorage.getItem('bake_user_expires_at')).toBeNull();
    expect(window.localStorage.getItem('bake_user_profile')).toBeNull();
  });

  it('persists the session state applied by the login feature hook', () => {
    const store = useAuthStore();
    store.applySession(
      {
        accessToken: 'user-token-1',
        expiresAt: '2026-07-12T01:00:00.000Z',
      },
      {
        id: '',
        phone: '13800000000',
        phoneVerified: true,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      },
    );

    expect(store.accessToken).toBe('user-token-1');
    expect(store.profile?.phone).toBe('13800000000');
    expect(window.localStorage.getItem('bake_user_token')).toBe('user-token-1');
  });
});
