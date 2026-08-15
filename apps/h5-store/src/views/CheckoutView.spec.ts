import { mount, type VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import CheckoutView from './CheckoutView.vue';
import { useAuthStore } from '../stores/auth.js';
import { useCartStore } from '../stores/cart.js';
import { customerApi } from '../api/customer.js';
import { ordersApi } from '../api/orders.js';
import {
  ApiErrorCode,
  FulfillmentType,
  OrderStatus,
  type AddressView,
  type CartItemView,
  type OrderQuoteView,
} from '@bake-mall/contracts';
import { apiClient, ApiClientError } from '../api/http.js';

/**
 * Checkout view contract pinned by Task 10.
 *
 * - Submitting the form without the per-mode required field shows a Chinese
 *   validation message; the request is NOT fired.
 *   - PICKUP requires `pickupTimeText` (期望取货时间).
 *   - DELIVERY requires a selected saved address (请选择配送地址).
 * - The checkout route requires a customer session, while the account itself
 *   may remain without a verified phone. The form requires an explicit contact
 *   phone for the immutable order snapshot.
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

function mountCheckout(
  prepareStore: (pinia: Pinia) => void = () => undefined,
): {
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
      { path: '/profile', component: { template: '<div />' } },
    ],
  });
  // Bind the test's store mutations to the SAME pinia the component
  // resolves `useCartStore()` etc. against.
  setActivePinia(pinia);
  useAuthStore().profile = verifiedProfile();
  prepareStore(pinia);
  const wrapper = mount(CheckoutView, {
    global: { plugins: [pinia, router] },
  });
  return { wrapper, pinia, router };
}

const quote: OrderQuoteView = {
  lines: [],
  goodsTotalCents: 6800,
  membershipDiscountCents: 0,
  discountedTotalCents: 6800,
  requestedCreditCents: 0,
  creditAppliedCents: 0,
  payableTotalCents: 6800,
  availableCreditCents: 0,
  maxCreditCents: 0,
  membership: null,
  quoteToken: 'checkout-test-quote-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

function seedQuoteApi(): void {
  vi.spyOn(apiClient, 'post').mockResolvedValue(quote);
}

function verifiedProfile() {
  return {
    id: 'u1',
    phone: '13800000000',
    phoneVerified: true as const,
    nickname: '小明',
    orderContactPhone: {
      configured: true as const,
      maskedPhone: '138****0000',
      version: 1,
    },
  };
}

function seedApis(opts?: {
  cart?: CartItemView[];
  addresses?: AddressView[];
  cartRefresh?: ReturnType<typeof vi.fn>;
  addressesRefresh?: ReturnType<typeof vi.fn>;
}) {
  const cartRefresh =
    opts?.cartRefresh ?? vi.fn().mockResolvedValue(opts?.cart ?? cart);
  const addressesRefresh =
    opts?.addressesRefresh ??
    vi.fn().mockResolvedValue(opts?.addresses ?? savedAddresses);
  vi.spyOn(customerApi, 'listCart').mockImplementation(cartRefresh);
  vi.spyOn(customerApi, 'listAddresses').mockImplementation(addressesRefresh);
  vi.spyOn(customerApi, 'getMe').mockImplementation(async () => {
    const current = useAuthStore().profile ?? verifiedProfile();
    return {
      id: current.id,
      nickname: current.nickname ?? null,
      avatarUrl: 'avatarUrl' in current ? (current.avatarUrl ?? null) : null,
      phone: current.phone ?? null,
      phoneVerified: current.phoneVerified,
      orderContactPhone: current.orderContactPhone,
    };
  });
  return { cartRefresh, addressesRefresh };
}

describe('CheckoutView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads checkout for an authenticated WeChat user without a verified account phone', async () => {
    seedApis();
    const { wrapper } = mountCheckout(() => {
      const auth = useAuthStore();
      auth.accessToken = 'wechat-token';
      auth.profile = {
        id: 'u1',
        nickname: 'Cake Fan',
        phoneVerified: false,
        orderContactPhone: {
          configured: true,
          maskedPhone: '138****0000',
          version: 1,
        },
      };
    });

    await flushPromises();

    expect(wrapper.find('[data-testid="contact-phone"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('138****0000');
    expect(customerApi.listCart).toHaveBeenCalledOnce();
  });

  it('requires pickup time for PICKUP and an address for DELIVERY', async () => {
    // Start with no saved addresses so the auto-default-fill doesn't
    // satisfy the DELIVERY address requirement on mode switch.
    seedApis({ addresses: [] });
    const { wrapper } = mountCheckout();
    await flushPromises();

    // Fill the always-required contact fields so the validation falls
    // through to the per-mode required-field check.
    await wrapper.get('[data-testid="contact-name"]').setValue('小明');

    expect(wrapper.findAll('.store-form-card').length).toBeGreaterThanOrEqual(
      3,
    );
    expect(
      wrapper.get('[data-testid="submit"]').attributes('aria-disabled'),
    ).toBeDefined();

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

  it('keeps the cart selection while refreshing and submits only selected items', async () => {
    const secondItem: CartItemView = {
      ...cart[0],
      id: 'cart-2',
      sku: { ...cart[0].sku, id: 'sku-2' },
      product: { ...cart[0].product, id: 'product-2', name: '海盐可颂' },
    };
    const items = [cart[0], secondItem];
    seedApis({ cart: items });
    seedQuoteApi();
    const { wrapper } = mountCheckout(() => {
      const store = useCartStore();
      store.applyItems(items);
      store.setSelected('cart-2', false);
    });
    await waitForQuote();
    const createSpy = vi.spyOn(ordersApi, 'create').mockResolvedValue({
      id: 'order-selected',
      orderNo: 'BM2026071200000099',
      status: OrderStatus.NEW,
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '小明',
      contactPhone: '13800000000',
      pickupTimeText: '明天上午十点',
      goodsTotalCents: 6800,
      membershipDiscountCents: 0,
      creditAppliedCents: 0,
      payableTotalCents: 6800,
      pricingVersion: 1,
      items: [],
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:00:00.000Z',
    });

    expect(wrapper.text()).toContain('示例蛋糕');
    expect(wrapper.text()).not.toContain('海盐可颂');
    await wrapper.get('[data-testid="fulfillment-pickup"]').trigger('click');
    await wrapper.get('[data-testid="contact-name"]').setValue('小明');
    await wrapper.get('[data-testid="pickup-time"]').setValue('明天上午十点');
    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(createSpy.mock.calls[0][0].cartItemIds).toEqual(['cart-1']);
  });

  it('submits a valid PICKUP order with a stable Idempotency-Key', async () => {
    const refreshSpy = vi.fn().mockResolvedValue(cart);
    seedApis({ cartRefresh: refreshSpy });
    seedQuoteApi();
    const { wrapper, router } = mountCheckout();
    await waitForQuote();
    const createSpy = vi.spyOn(ordersApi, 'create').mockResolvedValue({
      id: 'order-1',
      orderNo: 'BM2026071200000001',
      status: OrderStatus.NEW,
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: '小明',
      contactPhone: '13800000000',
      pickupTimeText: '明天上午十点',
      goodsTotalCents: 6800,
      membershipDiscountCents: 0,
      creditAppliedCents: 0,
      payableTotalCents: 6800,
      pricingVersion: 1,
      items: [],
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:00:00.000Z',
    });

    await wrapper.get('[data-testid="fulfillment-pickup"]').trigger('click');
    await wrapper.get('[data-testid="contact-name"]').setValue('小明');
    await wrapper.get('[data-testid="pickup-time"]').setValue('明天上午十点');

    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(createSpy).toHaveBeenCalledTimes(1);
    const [payload, key] = createSpy.mock.calls[0];
    expect(payload).toMatchObject({
      fulfillmentType: 'PICKUP',
      contactName: '小明',
      orderContactPhoneVersion: 1,
      pickupTimeText: '明天上午十点',
    });
    expect(payload).not.toHaveProperty('contactPhone');
    expect(JSON.stringify(payload)).not.toContain('13800000000');
    expect(payload).toMatchObject({
      requestedCreditCents: 0,
      quoteToken: 'checkout-test-quote-token',
    });
    expect(key).toBeTruthy();
    // Cart is refetched on success so the cleared items disappear.
    expect(refreshSpy).toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe('/orders/order-1');
  });

  it('generates a new Idempotency-Key when the payload changes after failure', async () => {
    seedApis();
    seedQuoteApi();
    const { wrapper } = mountCheckout();
    await waitForQuote();
    const createSpy = vi
      .spyOn(ordersApi, 'create')
      .mockRejectedValue(new ApiClientError(0, '网络异常,请稍后重试'));

    await wrapper.get('[data-testid="fulfillment-pickup"]').trigger('click');
    await wrapper.get('[data-testid="contact-name"]').setValue('小明');
    await wrapper.get('[data-testid="pickup-time"]').setValue('明天上午十点');
    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();
    const firstKey = createSpy.mock.calls[0][1] as string;

    await wrapper.get('[data-testid="contact-name"]').setValue('小明改名');
    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(createSpy.mock.calls[1][1]).not.toBe(firstKey);
  });

  it('未配置订单联系手机号时不提交并跳转我的设置', async () => {
    seedApis();
    seedQuoteApi();
    const { wrapper, router } = mountCheckout(() => {
      const auth = useAuthStore();
      auth.profile = {
        ...verifiedProfile(),
        orderContactPhone: {
          configured: false,
          maskedPhone: null,
          version: 0,
        },
      };
    });
    await waitForQuote();
    const createSpy = vi.spyOn(ordersApi, 'create');

    await wrapper.get('[data-testid="pickup-time"]').setValue('明天上午十点');
    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(createSpy).not.toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe(
      '/profile?edit=order-contact-phone&redirect=/checkout',
    );
  });

  it('联系手机号版本冲突时刷新脱敏资料并要求重新确认', async () => {
    seedApis();
    seedQuoteApi();
    const { wrapper, router } = mountCheckout();
    await waitForQuote();
    vi.spyOn(ordersApi, 'create').mockRejectedValue(
      new ApiClientError(409, 'version conflict', {
        code: ApiErrorCode.ORDER_CONTACT_PHONE_VERSION_CONFLICT,
      }),
    );
    vi.mocked(customerApi.getMe).mockResolvedValue({
      id: 'u1',
      nickname: '小明',
      avatarUrl: null,
      phone: '138****0000',
      phoneVerified: true,
      orderContactPhone: {
        configured: true,
        maskedPhone: '139****9999',
        version: 2,
      },
    });

    await wrapper.get('[data-testid="pickup-time"]').setValue('明天上午十点');
    await wrapper.get('form').trigger('submit.prevent');
    await flushPromises();

    expect(router.currentRoute.value.path).not.toBe('/profile');
    expect(wrapper.text()).toContain('139****9999');
    expect(wrapper.text()).toContain('请确认最新脱敏号码后重新提交');
  });

  it('reuses the same Idempotency-Key across retries until success', async () => {
    seedApis();
    seedQuoteApi();
    const { wrapper } = mountCheckout();
    await waitForQuote();
    const networkError = new ApiClientError(0, '网络异常,请稍后重试');
    const createSpy = vi
      .spyOn(ordersApi, 'create')
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({
        id: 'order-2',
        orderNo: 'BM2026071200000002',
        status: OrderStatus.NEW,
        fulfillmentType: FulfillmentType.PICKUP,
        contactName: '小明',
        contactPhone: '13800000000',
        pickupTimeText: '明天上午十点',
        goodsTotalCents: 6800,
        membershipDiscountCents: 0,
        creditAppliedCents: 0,
        payableTotalCents: 6800,
        pricingVersion: 1,
        items: [],
        createdAt: '2026-07-12T10:00:00.000Z',
        updatedAt: '2026-07-12T10:00:00.000Z',
      });

    await wrapper.get('[data-testid="fulfillment-pickup"]').trigger('click');
    await wrapper.get('[data-testid="contact-name"]').setValue('小明');
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

function waitForQuote(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 350));
}
