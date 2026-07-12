import { mount, type VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import CheckoutView from './CheckoutView.vue';
import { useAuthStore } from '../stores/auth.js';
import { useCartStore } from '../stores/cart.js';
import { useOrdersStore } from '../stores/orders.js';
import { useAddressesStore } from '../stores/addresses.js';
import type { CartItemView, AddressView } from '../api/customer.js';
import { ApiClientError } from '../api/http.js';

/**
 * Checkout view contract pinned by Task 10.
 *
 * - Submitting the form without the per-mode required field shows a Chinese
 *   validation message; the request is NOT fired.
 *   - PICKUP requires `pickupTimeText` (期望取货时间).
 *   - DELIVERY requires a selected saved address (请选择配送地址).
 * - The checkout view always asks `useAuthStore.requireVerifiedPhone('/checkout')`
 *   on entry so that unverified users are bounced to the login flow before
 *   any form interaction.
 * - Submitting a valid form fires exactly one POST /orders with a stable
 *   `Idempotency-Key` header. On success the form clears the key and the
 *   cart is refetched; the route transitions to `/orders/:id`.
 * - A failed submit retains the same Idempotency-Key so a retry hits the
 *   same server-side idempotency record instead of creating a duplicate
 *   order.
 */

const cart: CartItemView[] = [
  {
    id: 'cart-1',
    quantity: 1,
    available: true,
    sku: {
      id: 'sku-1',
      name: '6寸',
      attributes: { size: '6寸' },
      priceCents: 6800,
      stock: 3,
      imageUrl: null,
      isActive: true,
    },
    product: {
      id: 'product-1',
      name: '示例蛋糕',
      coverImageUrl: null,
      isActive: true,
    },
  },
];

const savedAddresses: AddressView[] = [
  {
    id: 'addr-1',
    recipient: '小明',
    phone: '13800000000',
    province: '浙江省',
    city: '杭州市',
    district: '西湖区',
    detail: '文一西路 1 号',
    isDefault: true,
  },
];

function mountCheckout(): {
  wrapper: VueWrapper;
  pinia: Pinia;
  router: Router;
} {
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/checkout', component: CheckoutView },
      { path: '/orders/:id', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
    ],
  });
  // Bind the test's store mutations to the SAME pinia the component
  // resolves `useCartStore()` etc. against.
  setActivePinia(pinia);
  const wrapper = mount(CheckoutView, {
    global: { plugins: [pinia, router] },
  });
  return { wrapper, pinia, router };
}

function verifiedProfile() {
  return {
    id: 'u1',
    phone: '13800000000',
    phoneVerified: true as const,
    nickname: '小明',
  };
}

function seedStores(opts?: {
  cart?: CartItemView[];
  addresses?: AddressView[];
  cartRefresh?: ReturnType<typeof vi.fn>;
  addressesRefresh?: ReturnType<typeof vi.fn>;
}) {
  const cartStore = useCartStore();
  cartStore.items = opts?.cart ?? cart;
  cartStore.refresh =
    opts?.cartRefresh ?? vi.fn().mockResolvedValue(opts?.cart ?? cart);
  const addressesStore = useAddressesStore();
  addressesStore.items = opts?.addresses ?? savedAddresses;
  addressesStore.refresh =
    opts?.addressesRefresh ??
    vi.fn().mockResolvedValue(opts?.addresses ?? savedAddresses);
  return { cartStore, addressesStore };
}

describe('CheckoutView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('redirects to login when the verified phone is missing on entry', () => {
    const auth = useAuthStore();
    auth.accessToken = 'tok';
    auth.profile = {
      id: 'u1',
      nickname: 'Cake Fan',
      phoneVerified: false,
    };
    // The router guard owns the redirect; the view's onMounted guard
    // simply re-affirms the same target when called directly.
    expect(auth.requireVerifiedPhone('/checkout')).toBe(
      '/login?redirect=%2Fcheckout',
    );
  });

  it('requires pickup time for PICKUP and an address for DELIVERY', async () => {
    useAuthStore().profile = verifiedProfile();
    const { wrapper } = mountCheckout();
    // Start with no saved addresses so the auto-default-fill doesn't
    // satisfy the DELIVERY address requirement on mode switch.
    seedStores({ addresses: [] });

    // Fill the always-required contact fields so the validation falls
    // through to the per-mode required-field check.
    await wrapper.get('[data-testid="contact-name"]').setValue('小明');
    await wrapper.get('[data-testid="contact-phone"]').setValue('13800000000');

    const pickupRadio = wrapper.get(
      '[data-testid="fulfillment-pickup"]',
    ) as unknown as {
      element: HTMLInputElement;
      setValue: (v: unknown) => Promise<void>;
    };
    await pickupRadio.setValue(true);
    await wrapper.get('form').trigger('submit.prevent');
    expect(wrapper.text()).toContain('请填写期望取货时间');

    const deliveryRadio = wrapper.get(
      '[data-testid="fulfillment-delivery"]',
    ) as unknown as {
      element: HTMLInputElement;
      setValue: (v: unknown) => Promise<void>;
    };
    await deliveryRadio.setValue(true);
    await wrapper.get('form').trigger('submit.prevent');
    expect(wrapper.text()).toContain('请选择配送地址');
  });

  it('submits a valid PICKUP order with a stable Idempotency-Key', async () => {
    useAuthStore().profile = verifiedProfile();
    const { wrapper } = mountCheckout();
    const refreshSpy = vi.fn().mockResolvedValue(cart);
    seedStores({ cartRefresh: refreshSpy });
    const ordersStore = useOrdersStore();
    const createSpy = vi.fn().mockResolvedValue({
      id: 'order-1',
      orderNo: 'BM2026071200000001',
      status: 'NEW',
      fulfillmentType: 'PICKUP',
      contactName: '小明',
      contactPhone: '13800000000',
      pickupTimeText: '明天上午十点',
      goodsTotalCents: 6800,
      items: [],
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:00:00.000Z',
    });
    ordersStore.create = createSpy;

    await wrapper.get('[data-testid="fulfillment-pickup"]').trigger('click');
    await wrapper.get('[data-testid="contact-name"]').setValue('小明');
    await wrapper.get('[data-testid="contact-phone"]').setValue('13800000000');
    await wrapper.get('[data-testid="pickup-time"]').setValue('明天上午十点');

    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(createSpy).toHaveBeenCalledTimes(1);
    const [payload, key] = createSpy.mock.calls[0];
    expect(payload).toMatchObject({
      fulfillmentType: 'PICKUP',
      contactName: '小明',
      contactPhone: '13800000000',
      pickupTimeText: '明天上午十点',
    });
    expect(key).toBeTruthy();
    // Cart is refetched on success so the cleared items disappear.
    expect(refreshSpy).toHaveBeenCalled();
  });

  it('reuses the same Idempotency-Key across retries until success', async () => {
    useAuthStore().profile = verifiedProfile();
    const { wrapper } = mountCheckout();
    seedStores();
    const ordersStore = useOrdersStore();
    const networkError = new ApiClientError(0, '网络异常,请稍后重试');
    const createSpy = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({
        id: 'order-2',
        orderNo: 'BM2026071200000002',
        status: 'NEW',
        fulfillmentType: 'PICKUP',
        contactName: '小明',
        contactPhone: '13800000000',
        pickupTimeText: '明天上午十点',
        goodsTotalCents: 6800,
        items: [],
        createdAt: '2026-07-12T10:00:00.000Z',
        updatedAt: '2026-07-12T10:00:00.000Z',
      });
    ordersStore.create = createSpy;

    await wrapper.get('[data-testid="fulfillment-pickup"]').trigger('click');
    await wrapper.get('[data-testid="contact-name"]').setValue('小明');
    await wrapper.get('[data-testid="contact-phone"]').setValue('13800000000');
    await wrapper.get('[data-testid="pickup-time"]').setValue('明天上午十点');

    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();
    expect(createSpy).toHaveBeenCalledTimes(1);
    const firstKey = createSpy.mock.calls[0][1] as string;
    expect(firstKey).toBeTruthy();

    // Retry after a network failure: same idempotency key should be reused.
    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();
    expect(createSpy).toHaveBeenCalledTimes(2);
    const secondKey = createSpy.mock.calls[1][1] as string;
    expect(secondKey).toBe(firstKey);
  });
});

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
