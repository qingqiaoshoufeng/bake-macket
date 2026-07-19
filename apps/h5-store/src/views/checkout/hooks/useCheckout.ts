import { computed, readonly, ref, watch } from 'vue';
import {
  FulfillmentType,
  type CreateOrderRequest,
  type OrderView,
  type UserProfileView,
} from '@bake-mall/contracts';

import { useAddressesStore } from '../../../stores/addresses.js';
import { useCartStore } from '../../../stores/cart.js';
import { useOrdersStore } from '../../../stores/orders.js';
import {
  captureSession,
  isCurrentSession,
  type SessionSnapshot,
} from '../../../stores/session.js';
import { addressesFeatureApi } from '../../addresses/api/index.js';
import { cartFeatureApi } from '../../cart/api/index.js';
import { checkoutFeatureApi } from '../api/index.js';
import {
  CHECKOUT_DEFAULTS,
  PHONE_PATTERN,
  REMARK_MAX_LENGTH,
} from '../config/defaults.js';
import type { CheckoutFormValues, CheckoutValidation } from '../type/index.js';

function randomByte(): number {
  return Math.floor(Math.random() * 256);
}

function createUuidBytes(webCrypto?: Crypto): Uint8Array {
  const bytes = webCrypto?.getRandomValues
    ? webCrypto.getRandomValues(new Uint8Array(16))
    : Uint8Array.from({ length: 16 }, randomByte);
  return Uint8Array.from(bytes, (byte, index) =>
    index === 6
      ? (byte & 0x0f) | 0x40
      : index === 8
        ? (byte & 0x3f) | 0x80
        : byte,
  );
}

export function generateIdempotencyKey(): string {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof webCrypto?.randomUUID === 'function')
    return webCrypto.randomUUID();
  const hex = Array.from(createUuidBytes(webCrypto), (byte) =>
    byte.toString(16).padStart(2, '0'),
  );
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export function validateCheckout(
  values: Readonly<CheckoutFormValues>,
  cartItemIds: readonly string[],
): CheckoutValidation {
  if (!cartItemIds.length)
    return { valid: false, message: '购物车为空,请先添加商品' };
  if (!values.contactName.trim())
    return { valid: false, message: '请填写联系人' };
  if (!PHONE_PATTERN.test(values.contactPhone.trim())) {
    return { valid: false, message: '请填写 11 位手机号' };
  }
  if (
    values.fulfillmentType === FulfillmentType.PICKUP &&
    !values.pickupTimeText.trim()
  ) {
    return { valid: false, message: '请填写期望取货时间' };
  }
  if (
    values.fulfillmentType === FulfillmentType.DELIVERY &&
    !values.addressId
  ) {
    return { valid: false, message: '请选择配送地址' };
  }
  return { valid: true };
}

export function mapCheckoutRequest(
  values: Readonly<CheckoutFormValues>,
  cartItemIds: readonly string[],
): CreateOrderRequest {
  const common = {
    contactName: values.contactName.trim(),
    contactPhone: values.contactPhone.trim(),
    cartItemIds: [...cartItemIds],
    ...(values.remark.trim()
      ? { remark: values.remark.trim().slice(0, REMARK_MAX_LENGTH) }
      : {}),
  };
  return values.fulfillmentType === FulfillmentType.PICKUP
    ? {
        ...common,
        fulfillmentType: FulfillmentType.PICKUP,
        pickupTimeText: values.pickupTimeText.trim(),
      }
    : {
        ...common,
        fulfillmentType: FulfillmentType.DELIVERY,
        addressId: values.addressId as string,
      };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useCheckout(profile: UserProfileView | null) {
  const cart = useCartStore();
  const addresses = useAddressesStore();
  const orders = useOrdersStore();
  const values = ref<CheckoutFormValues>({
    ...CHECKOUT_DEFAULTS,
    contactName: profile?.nickname ?? '',
  });
  const submitting = ref(false);
  const idempotencyKey = ref<string | null>(null);
  const formError = ref<string | null>(null);
  const submitError = ref<string | null>(null);

  const cartItemIds = computed(() =>
    cart.availableItems.map((item) => item.id),
  );
  const cartTotalCents = computed(() =>
    cart.availableItems.reduce(
      (sum, item) => sum + item.sku.priceCents * item.quantity,
      0,
    ),
  );
  const canSubmit = computed(
    () =>
      !submitting.value &&
      validateCheckout(values.value, cartItemIds.value).valid,
  );

  function updateValues(next: Partial<CheckoutFormValues>): void {
    values.value = { ...values.value, ...next };
  }

  watch(
    () => values.value.fulfillmentType,
    (next) => {
      if (next === FulfillmentType.DELIVERY) {
        updateValues({ addressId: addresses.defaultAddress?.id ?? null });
      }
    },
  );

  async function refreshCart(session: SessionSnapshot): Promise<void> {
    const items = await cartFeatureApi.list();
    if (isCurrentSession(session)) cart.applyItems(items);
  }

  async function refreshAddresses(session: SessionSnapshot): Promise<void> {
    const items = await addressesFeatureApi.list();
    if (isCurrentSession(session)) addresses.applyItems(items);
  }

  async function load(): Promise<void> {
    const session = captureSession();
    cart.setLoading(true);
    addresses.setLoading(true);
    cart.setError(null);
    addresses.setError(null);
    try {
      await Promise.all([refreshCart(session), refreshAddresses(session)]);
    } catch (error) {
      if (isCurrentSession(session)) {
        const message = errorMessage(error, '加载失败');
        cart.setError(message);
        addresses.setError(message);
      }
      throw error;
    } finally {
      if (isCurrentSession(session)) {
        cart.setLoading(false);
        addresses.setLoading(false);
      }
    }
  }

  async function createOrder(
    key: string,
    session: SessionSnapshot,
  ): Promise<OrderView> {
    orders.setSubmitting(true);
    orders.setError(null);
    try {
      const order = await checkoutFeatureApi.create(
        mapCheckoutRequest(values.value, cartItemIds.value),
        key,
      );
      if (isCurrentSession(session)) orders.applyCurrent(order);
      return order;
    } catch (error) {
      if (isCurrentSession(session)) {
        orders.setError(errorMessage(error, '提交失败'));
      }
      throw error;
    } finally {
      if (isCurrentSession(session)) orders.setSubmitting(false);
    }
  }

  async function submit(): Promise<OrderView | null> {
    formError.value = null;
    submitError.value = null;
    const validation = validateCheckout(values.value, cartItemIds.value);
    if (!validation.valid) {
      formError.value = validation.message;
      return null;
    }

    const session = captureSession();
    const key = idempotencyKey.value ?? generateIdempotencyKey();
    idempotencyKey.value = key;
    submitting.value = true;
    try {
      const order = await createOrder(key, session);
      if (isCurrentSession(session)) idempotencyKey.value = null;
      try {
        await refreshCart(session);
      } catch {
        // 下单已成功，购物车刷新失败不阻断订单跳转。
      }
      return order;
    } catch (error) {
      if (isCurrentSession(session)) {
        submitError.value = errorMessage(error, '提交失败');
      }
      throw error;
    } finally {
      if (isCurrentSession(session)) submitting.value = false;
    }
  }

  return {
    data: {
      values: readonly(values),
      cartItems: computed(() => cart.items),
      availableItems: computed(() => cart.availableItems),
      addresses: computed(() => addresses.items),
      cartTotalCents,
      formError: readonly(formError),
      submitError: readonly(submitError),
    },
    loading: computed(() => cart.loading || addresses.loading),
    submitting: readonly(submitting),
    canSubmit,
    methods: { load, updateValues, submit },
  };
}
