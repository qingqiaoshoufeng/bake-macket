import { computed, readonly, ref, watch } from 'vue';
import {
  ApiErrorCode,
  FulfillmentType,
  type CreateOrderRequest,
  type OrderQuoteView,
  type OrderView,
  type UserProfileView,
} from '@bake-mall/contracts';

import { ApiClientError } from '../../../api/http.js';
import { useAddressesStore } from '../../../stores/addresses.js';
import { useAuthStore } from '../../../stores/auth.js';
import { useCartStore } from '../../../stores/cart.js';
import { useOrdersStore } from '../../../stores/orders.js';
import {
  captureSession,
  isCurrentSession,
  type SessionSnapshot,
} from '../../../stores/session.js';
import { generateIdempotencyKey } from '../../../utils/idempotency.js';
import { yuanTextToCents } from '../../../utils/money.js';
import { addressesFeatureApi } from '../../addresses/api/index.js';
import { cartFeatureApi } from '../../cart/api/index.js';
import { profileFeatureApi } from '../../profile/api/index.js';
import { mapProfile } from '../../profile/hooks/useProfile.js';
import { checkoutFeatureApi } from '../api/index.js';
import {
  CHECKOUT_DEFAULTS,
  ORDER_QUOTE_DEBOUNCE_MS,
  REMARK_MAX_LENGTH,
} from '../config/defaults.js';
import type { CheckoutFormValues, CheckoutValidation } from '../type/index.js';
import { useOrderQuote } from './useOrderQuote.js';

export { generateIdempotencyKey } from '../../../utils/idempotency.js';

export type CheckoutRecovery = 'contact-phone-missing' | 'contact-phone-stale';

export function validateCheckout(
  values: Readonly<CheckoutFormValues>,
  cartItemIds: readonly string[],
  hasOrderContactPhone: boolean,
): CheckoutValidation {
  if (!cartItemIds.length)
    return { valid: false, message: '购物车为空,请先添加商品' };
  if (!values.contactName.trim())
    return { valid: false, message: '请填写联系人' };
  if (!hasOrderContactPhone) {
    return { valid: false, message: '请先在“我的”设置订单联系手机号' };
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
  quote: Readonly<OrderQuoteView> | null,
  orderContactPhoneVersion: number,
): CreateOrderRequest {
  const common = {
    contactName: values.contactName.trim(),
    orderContactPhoneVersion,
    cartItemIds: [...cartItemIds],
    ...(values.remark.trim()
      ? { remark: values.remark.trim().slice(0, REMARK_MAX_LENGTH) }
      : {}),
  };
  if (!quote) {
    throw new Error('报价已更新，请确认最新金额后再次下单');
  }
  const quoteIntent = {
    requestedCreditCents: quote.requestedCreditCents,
    quoteToken: quote.quoteToken,
  };
  if (values.fulfillmentType === FulfillmentType.PICKUP) {
    return {
      ...common,
      ...quoteIntent,
      fulfillmentType: FulfillmentType.PICKUP,
      pickupTimeText: values.pickupTimeText.trim(),
    };
  }
  return {
    ...common,
    ...quoteIntent,
    fulfillmentType: FulfillmentType.DELIVERY,
    addressId: values.addressId as string,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useCheckout(initialProfile: UserProfileView | null) {
  const auth = useAuthStore();
  const cart = useCartStore();
  const addresses = useAddressesStore();
  const orders = useOrdersStore();
  const profile = ref<UserProfileView | null>(initialProfile);
  const values = ref<CheckoutFormValues>({
    ...CHECKOUT_DEFAULTS,
    contactName: initialProfile?.nickname ?? '',
  });
  const submitting = ref(false);
  const idempotencyReservation = ref<{
    key: string;
    requestFingerprint: string;
  } | null>(null);
  const formError = ref<string | null>(null);
  const submitError = ref<string | null>(null);
  const recovery = ref<CheckoutRecovery | null>(null);

  const cartItemIds = computed(() => cart.selectedItems.map((item) => item.id));
  const cartTotalCents = computed(() =>
    cart.selectedItems.reduce(
      (sum, item) => sum + item.sku.priceCents * item.quantity,
      0,
    ),
  );
  const orderContactPhone = computed(
    () => profile.value?.orderContactPhone ?? null,
  );
  const hasOrderContactPhone = computed(
    () => orderContactPhone.value?.configured === true,
  );
  const quoteIntent = computed(() => ({
    cartItemIds: cartItemIds.value,
    cartVersion: cart.selectedItems
      .map(
        (item) =>
          `${item.id}:${item.sku.id}:${item.quantity}:${item.sku.priceCents}`,
      )
      .join('|'),
    fulfillmentType: values.value.fulfillmentType,
  }));
  const orderQuote = useOrderQuote({
    intent: quoteIntent,
    request: checkoutFeatureApi.quote,
    debounceMs: ORDER_QUOTE_DEBOUNCE_MS,
  });
  const hasSubmittablePricing = computed(() => {
    try {
      yuanTextToCents(orderQuote.data.requestedCreditText.value);
      return orderQuote.canUseQuote.value;
    } catch {
      return false;
    }
  });
  const canSubmit = computed(
    () =>
      !submitting.value &&
      hasSubmittablePricing.value &&
      validateCheckout(
        values.value,
        cartItemIds.value,
        hasOrderContactPhone.value,
      ).valid,
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

  async function refreshProfile(session: SessionSnapshot): Promise<void> {
    const next = mapProfile(await profileFeatureApi.get());
    if (!isCurrentSession(session)) return;
    profile.value = next;
    auth.setProfile(next);
  }

  async function load(): Promise<void> {
    const session = captureSession();
    cart.setLoading(true);
    addresses.setLoading(true);
    cart.setError(null);
    addresses.setError(null);
    try {
      await Promise.all([
        refreshCart(session),
        refreshAddresses(session),
        refreshProfile(session),
      ]);
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
    request: CreateOrderRequest,
    session: SessionSnapshot,
  ): Promise<OrderView> {
    orders.setSubmitting(true);
    orders.setError(null);
    try {
      const order = await checkoutFeatureApi.create(request, key);
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

  async function recoverContactPhone(
    kind: CheckoutRecovery,
    message: string,
    session: SessionSnapshot,
  ): Promise<null> {
    idempotencyReservation.value = null;
    recovery.value = kind;
    try {
      await refreshProfile(session);
    } catch {
      // 保留服务端错误指引，用户可进入“我的”重新加载并设置。
    }
    submitError.value = message;
    return null;
  }

  async function submit(): Promise<OrderView | null> {
    formError.value = null;
    submitError.value = null;
    recovery.value = null;
    const validation = validateCheckout(
      values.value,
      cartItemIds.value,
      hasOrderContactPhone.value,
    );
    if (!validation.valid) {
      formError.value = validation.message;
      if (!hasOrderContactPhone.value) recovery.value = 'contact-phone-missing';
      return null;
    }

    try {
      yuanTextToCents(orderQuote.data.requestedCreditText.value);
    } catch (error) {
      submitError.value = errorMessage(error, '消费金输入格式不正确');
      return null;
    }
    const usableQuote = orderQuote.methods.requireUsableQuote();
    if (!usableQuote) {
      submitError.value = '报价已更新，请确认最新金额后再次下单';
      return null;
    }

    const contact = orderContactPhone.value;
    if (!contact?.configured) {
      formError.value = '请先在“我的”设置订单联系手机号';
      recovery.value = 'contact-phone-missing';
      return null;
    }
    const request = mapCheckoutRequest(
      values.value,
      cartItemIds.value,
      usableQuote,
      contact.version,
    );
    const requestFingerprint = JSON.stringify(request);
    const reservation = idempotencyReservation.value;
    const key =
      reservation?.requestFingerprint === requestFingerprint
        ? reservation.key
        : generateIdempotencyKey();
    idempotencyReservation.value = { key, requestFingerprint };
    const session = captureSession();
    submitting.value = true;
    try {
      const order = await createOrder(key, request, session);
      if (isCurrentSession(session)) idempotencyReservation.value = null;
      try {
        await refreshCart(session);
      } catch {
        // 下单已成功，购物车刷新失败不阻断订单跳转。
      }
      return order;
    } catch (error) {
      if (isCurrentSession(session) && error instanceof ApiClientError) {
        if (error.code === ApiErrorCode.ORDER_QUOTE_STALE) {
          idempotencyReservation.value = null;
          orderQuote.methods.markStale('报价已失效，请确认最新金额后再次下单');
          submitError.value = '报价已失效，请确认最新金额后再次下单';
          return null;
        }
        if (error.code === ApiErrorCode.ORDER_CONTACT_PHONE_REQUIRED) {
          return recoverContactPhone(
            'contact-phone-missing',
            '订单联系手机号尚未设置，请前往“我的”设置',
            session,
          );
        }
        if (error.code === ApiErrorCode.ORDER_CONTACT_PHONE_VERSION_CONFLICT) {
          return recoverContactPhone(
            'contact-phone-stale',
            '订单联系手机号已更新，请确认最新脱敏号码后重新提交',
            session,
          );
        }
      }
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
      profile: readonly(profile),
      orderContactPhone,
      cartItems: computed(() => cart.items),
      availableItems: computed(() => cart.selectedItems),
      addresses: computed(() => addresses.items),
      cartTotalCents,
      formError: readonly(formError),
      submitError: readonly(submitError),
      recovery: readonly(recovery),
      quote: orderQuote.data.quote,
      requestedCreditText: orderQuote.data.requestedCreditText,
      quoteValidationError: orderQuote.data.validationError,
      quoteError: orderQuote.data.error,
      quoteRequiresConfirmation: orderQuote.data.requiresConfirmation,
    },
    loading: computed(() => cart.loading || addresses.loading),
    quoteLoading: orderQuote.loading,
    submitting: readonly(submitting),
    canSubmit,
    methods: {
      load,
      updateValues,
      updateRequestedCreditText: orderQuote.methods.updateRequestedCreditText,
      confirmQuote: orderQuote.methods.confirmLatest,
      submit,
    },
  };
}
