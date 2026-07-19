import { createPinia, setActivePinia } from 'pinia';
import { isReadonly } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FulfillmentType,
  type AddressView,
  type CartItemView,
} from '@bake-mall/contracts';

import { useAddresses } from './addresses/hooks/useAddresses.js';
import { useCart } from './cart/hooks/useCart.js';
import { useCheckout } from './checkout/hooks/useCheckout.js';
import { useLogin } from './login/hooks/useLogin.js';
import { useOrderDetail } from './orders/hooks/useOrderDetail.js';
import { useOrderList } from './orders/hooks/useOrderList.js';
import { useAddressesStore } from '../stores/addresses.js';
import { useAuthStore } from '../stores/auth.js';
import { useCartStore } from '../stores/cart.js';
import { useOrdersStore } from '../stores/orders.js';

const apiMocks = vi.hoisted(() => ({
  addressCreate: vi.fn(),
  addressList: vi.fn(),
  addressRemove: vi.fn(),
  addressSetDefault: vi.fn(),
  addressUpdate: vi.fn(),
  cartList: vi.fn(),
  cartRemove: vi.fn(),
  cartUpsert: vi.fn(),
  checkoutCreate: vi.fn(),
  login: vi.fn(),
  orderGetOne: vi.fn(),
  orderList: vi.fn(),
}));

const legacyApiMocks = vi.hoisted(() => ({
  addressCreate: vi.fn(),
  addressList: vi.fn(),
  addressRemove: vi.fn(),
  addressSetDefault: vi.fn(),
  addressUpdate: vi.fn(),
  cartList: vi.fn(),
  cartRemove: vi.fn(),
  cartUpsert: vi.fn(),
  login: vi.fn(),
  orderCreate: vi.fn(),
  orderGetOne: vi.fn(),
  orderList: vi.fn(),
}));

vi.mock('./addresses/api/index.js', () => ({
  addressesFeatureApi: {
    create: apiMocks.addressCreate,
    list: apiMocks.addressList,
    remove: apiMocks.addressRemove,
    setDefault: apiMocks.addressSetDefault,
    update: apiMocks.addressUpdate,
  },
}));
vi.mock('./cart/api/index.js', () => ({
  cartFeatureApi: {
    list: apiMocks.cartList,
    remove: apiMocks.cartRemove,
    upsert: apiMocks.cartUpsert,
  },
}));
vi.mock('./checkout/api/index.js', () => ({
  checkoutFeatureApi: { create: apiMocks.checkoutCreate },
}));
vi.mock('./login/api/index.js', () => ({
  loginFeatureApi: { login: apiMocks.login },
}));
vi.mock('./orders/api/index.js', () => ({
  ordersFeatureApi: {
    create: vi.fn(),
    getOne: apiMocks.orderGetOne,
    list: apiMocks.orderList,
  },
}));

vi.mock('../api/customer.js', () => ({
  customerApi: {
    createAddress: legacyApiMocks.addressCreate,
    listAddresses: legacyApiMocks.addressList,
    listCart: legacyApiMocks.cartList,
    removeAddress: legacyApiMocks.addressRemove,
    removeCartItem: legacyApiMocks.cartRemove,
    setDefaultAddress: legacyApiMocks.addressSetDefault,
    updateAddress: legacyApiMocks.addressUpdate,
    upsertCartItem: legacyApiMocks.cartUpsert,
  },
}));
vi.mock('../api/auth.js', () => ({
  authApi: { loginWithDevelopmentCode: legacyApiMocks.login },
}));
vi.mock('../api/orders.js', () => ({
  ordersApi: {
    create: legacyApiMocks.orderCreate,
    getMine: legacyApiMocks.orderGetOne,
    listMine: legacyApiMocks.orderList,
  },
}));

const cartItem: CartItemView = {
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
    name: '草莓蛋糕',
    coverImageUrl: null,
    isActive: true,
  },
};

const address: AddressView = {
  id: 'address-1',
  recipient: '小明',
  phone: '13800000000',
  province: '浙江省',
  city: '杭州市',
  district: '西湖区',
  detail: '文一西路 1 号',
  isDefault: true,
};

const order = {
  id: 'order-1',
  orderNo: 'BM2026071900000001',
  status: 'NEW',
  fulfillmentType: 'PICKUP',
  contactName: '小明',
  contactPhone: '13800000000',
  pickupTimeText: '明天上午十点',
  goodsTotalCents: 6800,
  items: [],
  createdAt: '2026-07-19T10:00:00.000Z',
  updatedAt: '2026-07-19T10:00:00.000Z',
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  apiMocks.addressList.mockResolvedValue([address]);
  apiMocks.cartList.mockResolvedValue([cartItem]);
  apiMocks.checkoutCreate.mockResolvedValue(order);
  apiMocks.login.mockResolvedValue({ accessToken: 'token' });
  apiMocks.orderGetOne.mockResolvedValue(order);
  apiMocks.orderList.mockResolvedValue([order]);
  legacyApiMocks.addressList.mockResolvedValue([address]);
  legacyApiMocks.cartList.mockResolvedValue([cartItem]);
  legacyApiMocks.login.mockResolvedValue({ accessToken: 'legacy-token' });
  legacyApiMocks.orderCreate.mockResolvedValue(order);
  legacyApiMocks.orderGetOne.mockResolvedValue(order);
  legacyApiMocks.orderList.mockResolvedValue([order]);
});

describe('feature hooks consume their feature API', () => {
  it('routes cart requests through cartFeatureApi', async () => {
    apiMocks.cartUpsert.mockResolvedValue(cartItem);
    const cart = useCart();
    await cart.methods.refresh();
    await cart.methods.add({ skuId: cartItem.sku.id, quantity: 1 });

    expect(apiMocks.cartList).toHaveBeenCalledOnce();
    expect(apiMocks.cartUpsert).toHaveBeenCalledWith({
      skuId: 'sku-1',
      quantity: 2,
    });
    expect(legacyApiMocks.cartList).not.toHaveBeenCalled();
    expect(legacyApiMocks.cartUpsert).not.toHaveBeenCalled();
  });

  it('routes address requests through addressesFeatureApi', async () => {
    const addresses = useAddresses();
    await addresses.methods.refresh();

    expect(apiMocks.addressList).toHaveBeenCalledOnce();
    expect(legacyApiMocks.addressList).not.toHaveBeenCalled();
  });

  it('routes order list and detail requests through ordersFeatureApi', async () => {
    await useOrderList().methods.refresh();
    await useOrderDetail().methods.load(order.id);

    expect(apiMocks.orderList).toHaveBeenCalledOnce();
    expect(apiMocks.orderGetOne).toHaveBeenCalledWith(order.id);
    expect(legacyApiMocks.orderList).not.toHaveBeenCalled();
    expect(legacyApiMocks.orderGetOne).not.toHaveBeenCalled();
  });

  it('clears the previous order before loading a new id and keeps it clear on failure', async () => {
    const detail = useOrderDetail();
    await detail.methods.load(order.id);
    expect(detail.data.order.value?.id).toBe(order.id);

    let rejectRequest: ((error: Error) => void) | undefined;
    apiMocks.orderGetOne.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    const pending = detail.methods.load('order-2');

    expect(detail.data.order.value).toBeNull();
    rejectRequest?.(new Error('订单不存在'));
    await expect(pending).rejects.toThrow('订单不存在');
    expect(detail.data.order.value).toBeNull();
    expect(detail.error.value).toBe('订单不存在');
  });

  it('keeps the latest order when an older request resolves afterward', async () => {
    const detail = useOrderDetail();
    const orderB = { ...order, id: 'order-b', orderNo: 'BM-B' };
    let resolveA: ((value: typeof order) => void) | undefined;
    apiMocks.orderGetOne
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockResolvedValueOnce(orderB);

    const requestA = detail.methods.load('order-a');
    const requestB = detail.methods.load('order-b');
    await requestB;
    resolveA?.({ ...order, id: 'order-a', orderNo: 'BM-A' });
    await requestA;

    expect(detail.data.order.value?.id).toBe('order-b');
    expect(detail.error.value).toBeNull();
    expect(detail.loading.value).toBe(false);
  });

  it('does not let an older failure overwrite a newer successful order', async () => {
    const detail = useOrderDetail();
    const orderB = { ...order, id: 'order-b', orderNo: 'BM-B' };
    let rejectA: ((error: Error) => void) | undefined;
    apiMocks.orderGetOne
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectA = reject;
          }),
      )
      .mockResolvedValueOnce(orderB);

    const requestA = detail.methods.load('order-a');
    const requestB = detail.methods.load('order-b');
    await requestB;
    rejectA?.(new Error('旧请求失败'));
    await expect(requestA).rejects.toThrow('旧请求失败');

    expect(detail.data.order.value?.id).toBe('order-b');
    expect(detail.error.value).toBeNull();
    expect(detail.loading.value).toBe(false);
  });

  it('does not apply pending cart, address, or order results after the session changes', async () => {
    const auth = useAuthStore();
    auth.applySession(
      { accessToken: 'token-a', expiresAt: '2026-07-20T00:00:00.000Z' },
      { id: 'user-a', phoneVerified: true },
    );
    let resolveCart: ((value: CartItemView[]) => void) | undefined;
    let resolveAddresses: ((value: AddressView[]) => void) | undefined;
    let resolveOrders: ((value: (typeof order)[]) => void) | undefined;
    let resolveDetail: ((value: typeof order) => void) | undefined;
    apiMocks.cartList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCart = resolve;
        }),
    );
    apiMocks.addressList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAddresses = resolve;
        }),
    );
    apiMocks.orderList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOrders = resolve;
        }),
    );
    apiMocks.orderGetOne.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve;
        }),
    );

    const cartRequest = useCart().methods.refresh();
    const addressRequest = useAddresses().methods.refresh();
    const orderRequest = useOrderList().methods.refresh();
    const detailRequest = useOrderDetail().methods.load('order-a');
    auth.applySession(
      { accessToken: 'token-b', expiresAt: '2026-07-20T00:00:00.000Z' },
      { id: 'user-b', phoneVerified: true },
    );
    resolveCart?.([cartItem]);
    resolveAddresses?.([address]);
    resolveOrders?.([order]);
    resolveDetail?.(order);
    await Promise.all([
      cartRequest,
      addressRequest,
      orderRequest,
      detailRequest,
    ]);

    expect(useCartStore().$state).toMatchObject({
      items: [],
      loading: false,
      lastError: null,
    });
    expect(useAddressesStore().$state).toMatchObject({
      items: [],
      loading: false,
      lastError: null,
    });
    expect(useOrdersStore().$state).toMatchObject({
      items: [],
      current: null,
      loading: false,
      lastError: null,
    });
  });

  it('does not apply old-session request errors or finally state after switching users', async () => {
    const auth = useAuthStore();
    auth.applySession(
      { accessToken: 'token-a', expiresAt: '2026-07-20T00:00:00.000Z' },
      { id: 'user-a', phoneVerified: true },
    );
    let rejectCart: ((error: Error) => void) | undefined;
    let rejectAddresses: ((error: Error) => void) | undefined;
    let rejectOrders: ((error: Error) => void) | undefined;
    apiMocks.cartList.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectCart = reject;
        }),
    );
    apiMocks.addressList.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectAddresses = reject;
        }),
    );
    apiMocks.orderList.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOrders = reject;
        }),
    );

    const requests = [
      useCart().methods.refresh(),
      useAddresses().methods.refresh(),
      useOrderList().methods.refresh(),
    ];
    auth.applySession(
      { accessToken: 'token-b', expiresAt: '2026-07-20T00:00:00.000Z' },
      { id: 'user-b', phoneVerified: true },
    );
    rejectCart?.(new Error('A cart error'));
    rejectAddresses?.(new Error('A address error'));
    rejectOrders?.(new Error('A order error'));
    await Promise.allSettled(requests);

    expect(useCartStore().$state).toMatchObject({
      items: [],
      loading: false,
      lastError: null,
    });
    expect(useAddressesStore().$state).toMatchObject({
      items: [],
      loading: false,
      lastError: null,
    });
    expect(useOrdersStore().$state).toMatchObject({
      items: [],
      current: null,
      loading: false,
      lastError: null,
    });
  });

  it('routes login through loginFeatureApi before applying session state', async () => {
    const notify = vi.fn();
    let submit: (() => Promise<boolean>) | null = null;
    const wrapper = mount({
      setup() {
        submit = useLogin(true, notify).methods.submit;
        return {};
      },
      template: '<div />',
    });
    expect(submit).not.toBeNull();
    await (submit as unknown as () => Promise<boolean>)();

    expect(apiMocks.login).toHaveBeenCalledWith('13800000000', '123456');
    expect(legacyApiMocks.login).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('routes checkout load and submit through feature APIs', async () => {
    const checkout = useCheckout({
      id: 'user-1',
      nickname: '小明',
      phone: '13800000000',
      phoneVerified: true,
    });
    await checkout.methods.load();
    checkout.methods.updateValues({
      contactPhone: '13800000000',
      fulfillmentType: FulfillmentType.PICKUP,
      pickupTimeText: '明天上午十点',
    });
    await checkout.methods.submit();

    expect(apiMocks.cartList).toHaveBeenCalledTimes(2);
    expect(apiMocks.addressList).toHaveBeenCalledOnce();
    expect(apiMocks.checkoutCreate).toHaveBeenCalledOnce();
    expect(legacyApiMocks.orderCreate).not.toHaveBeenCalled();
  });
});

describe('feature hook form state is immutable', () => {
  it('replaces the whole address values object without mutating the old reference', () => {
    const addresses = useAddresses();
    const previous = addresses.data.values.value;

    expect(isReadonly(addresses.data.values)).toBe(true);
    addresses.methods.updateValues({ receiverName: '新名字' });

    expect(addresses.data.values.value).not.toBe(previous);
    expect(previous.receiverName).toBe('');
    expect(addresses.data.values.value.receiverName).toBe('新名字');
  });

  it('replaces the whole checkout values object without mutating the old reference', () => {
    const checkout = useCheckout(null);
    const previous = checkout.data.values.value;

    expect(isReadonly(checkout.data.values)).toBe(true);
    checkout.methods.updateValues({
      fulfillmentType: FulfillmentType.DELIVERY,
    });

    expect(checkout.data.values.value).not.toBe(previous);
    expect(previous.fulfillmentType).toBe(FulfillmentType.PICKUP);
    expect(checkout.data.values.value.fulfillmentType).toBe(
      FulfillmentType.DELIVERY,
    );
  });
});
