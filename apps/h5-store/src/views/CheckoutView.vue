<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { FulfillmentType, type CreateOrderRequest } from '@bake-mall/contracts';

import { useAuthStore } from '../stores/auth.js';
import { useCartStore } from '../stores/cart.js';
import { useAddressesStore } from '../stores/addresses.js';
import { useOrdersStore } from '../stores/orders.js';

const auth = useAuthStore();
const cart = useCartStore();
const addresses = useAddressesStore();
const orders = useOrdersStore();
const router = useRouter();

const fulfillmentType = ref<FulfillmentType>(FulfillmentType.PICKUP);
const contactName = ref('');
const contactPhone = ref('');
const pickupTimeText = ref('');
const addressId = ref<string | null>(null);
const remark = ref('');

const submitting = ref(false);
const idempotencyKey = ref<string | null>(null);
const lastError = ref<string | null>(null);
const formError = ref<string | null>(null);

/** Maximum length of the optional order remark (300 Chinese chars). */
const REMARK_MAX_LENGTH = 300;

const cartItemIds = computed(() => cart.availableItems.map((item) => item.id));

const cartTotalCents = computed(() =>
  cart.availableItems.reduce(
    (sum, item) => sum + item.sku.priceCents * item.quantity,
    0,
  ),
);

const canSubmit = computed(() => {
  if (submitting.value) return false;
  if (cartItemIds.value.length === 0) return false;
  if (!contactName.value.trim()) return false;
  if (!/^1\d{10}$/.test(contactPhone.value.trim())) return false;
  if (fulfillmentType.value === FulfillmentType.PICKUP) {
    if (!pickupTimeText.value.trim()) return false;
  } else {
    if (!addressId.value) return false;
  }
  return true;
});

/**
 * Mint a fresh idempotency key. Using `crypto.randomUUID` keeps the value
 * stable across the first request and any retries because we cache it in
 * the local `idempotencyKey` ref. The key is cleared only after the
 * server reports a successful create, so a flaky network can replay the
 * same key without risk of a duplicate order.
 */
function generateIdempotencyKey(): string {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  // Fallback for browsers without `randomUUID`; matches UUID v4 shape.
  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

onMounted(async () => {
  // The router guard already blocks unverified users, but calling this on
  // entry means a session that expires mid-render still bounces cleanly.
  const redirect = auth.requireVerifiedPhone('/checkout');
  if (redirect) {
    await router.replace(redirect);
    return;
  }

  // Pre-fill contact details from the masked profile.
  if (auth.profile?.nickname) {
    contactName.value = auth.profile.nickname;
  }

  // Load the cart + address book in parallel so the form is ready as soon
  // as the user picks a fulfilment mode.
  try {
    await Promise.all([cart.refresh(), addresses.refresh()]);
  } catch {
    showToast('结算信息加载失败,请稍后重试');
  }
});

// Switching to DELIVERY requires the user to explicitly pick an address;
// clearing the field on mode change ensures validation can surface the
// "请选择配送地址" message rather than silently submitting the default.
watch(fulfillmentType, (next) => {
  if (next === FulfillmentType.DELIVERY) {
    addressId.value = addresses.defaultAddress?.id ?? null;
  }
});

async function onSubmit(): Promise<void> {
  formError.value = null;
  lastError.value = null;

  if (cartItemIds.value.length === 0) {
    formError.value = '购物车为空,请先添加商品';
    return;
  }
  if (!contactName.value.trim()) {
    formError.value = '请填写联系人';
    return;
  }
  if (!/^1\d{10}$/.test(contactPhone.value.trim())) {
    formError.value = '请填写 11 位手机号';
    return;
  }

  let body: CreateOrderRequest;
  if (fulfillmentType.value === FulfillmentType.PICKUP) {
    if (!pickupTimeText.value.trim()) {
      formError.value = '请填写期望取货时间';
      return;
    }
    body = {
      fulfillmentType: FulfillmentType.PICKUP,
      contactName: contactName.value.trim(),
      contactPhone: contactPhone.value.trim(),
      cartItemIds: cartItemIds.value,
      pickupTimeText: pickupTimeText.value.trim(),
      ...(remark.value.trim()
        ? { remark: remark.value.trim().slice(0, REMARK_MAX_LENGTH) }
        : {}),
    };
  } else {
    if (!addressId.value) {
      formError.value = '请选择配送地址';
      return;
    }
    body = {
      fulfillmentType: FulfillmentType.DELIVERY,
      contactName: contactName.value.trim(),
      contactPhone: contactPhone.value.trim(),
      cartItemIds: cartItemIds.value,
      addressId: addressId.value,
      ...(remark.value.trim()
        ? { remark: remark.value.trim().slice(0, REMARK_MAX_LENGTH) }
        : {}),
    };
  }

  if (!idempotencyKey.value) {
    idempotencyKey.value = generateIdempotencyKey();
  }

  submitting.value = true;
  try {
    const order = await orders.create(body, idempotencyKey.value);
    // The server has accepted the order — drop the cached key so the next
    // checkout mints a fresh one. Refetch the cart so the cleared items
    // disappear from the bag, then navigate to the detail page.
    idempotencyKey.value = null;
    try {
      await cart.refresh();
    } catch {
      // Cart refresh failure is non-blocking — the order itself succeeded.
    }
    showToast({ type: 'success', message: '下单成功' });
    await router.replace(`/orders/${order.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '提交失败';
    lastError.value = message;
    showToast(message);
    // Keep `idempotencyKey` and the form values intact so a retry hits
    // the same server-side idempotency record rather than creating a
    // duplicate order.
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="checkout">
    <header class="checkout__hero">
      <h1>结算订单</h1>
      <p>提交前请确认履约方式、联系人和备注信息。</p>
    </header>

    <section v-if="cart.items.length" class="checkout__cart">
      <h2>商品清单</h2>
      <ul>
        <li v-for="item in cart.availableItems" :key="item.id">
          <div class="checkout__cart-name">{{ item.product.name }}</div>
          <div class="checkout__cart-sku">
            {{ item.sku.name }} × {{ item.quantity }}
          </div>
          <div class="checkout__cart-price">
            ¥{{ ((item.sku.priceCents * item.quantity) / 100).toFixed(2) }}
          </div>
        </li>
      </ul>
      <div class="checkout__cart-total">
        <span>合计</span>
        <span>¥{{ (cartTotalCents / 100).toFixed(2) }}</span>
      </div>
    </section>

    <p v-else class="checkout__empty">购物车为空,请先添加商品。</p>

    <form class="checkout__form" @submit.prevent="onSubmit">
      <fieldset class="checkout__field">
        <legend>履约方式</legend>
        <label class="checkout__radio">
          <input
            v-model="fulfillmentType"
            type="radio"
            name="fulfillmentType"
            :value="FulfillmentType.PICKUP"
            data-testid="fulfillment-pickup"
          />
          <span>到店自提</span>
        </label>
        <label class="checkout__radio">
          <input
            v-model="fulfillmentType"
            type="radio"
            name="fulfillmentType"
            :value="FulfillmentType.DELIVERY"
            data-testid="fulfillment-delivery"
          />
          <span>同城配送</span>
        </label>
      </fieldset>

      <label class="checkout__field">
        <span>联系人</span>
        <input
          v-model="contactName"
          type="text"
          maxlength="64"
          autocomplete="name"
          placeholder="联系人姓名"
          data-testid="contact-name"
        />
      </label>

      <label class="checkout__field">
        <span>手机号</span>
        <input
          v-model="contactPhone"
          type="tel"
          inputmode="numeric"
          maxlength="11"
          autocomplete="tel"
          placeholder="11 位手机号"
          data-testid="contact-phone"
        />
      </label>

      <template v-if="fulfillmentType === FulfillmentType.PICKUP">
        <label class="checkout__field">
          <span>期望取货时间</span>
          <textarea
            v-model="pickupTimeText"
            rows="3"
            maxlength="256"
            placeholder="例如:明天上午十点"
            data-testid="pickup-time"
          />
        </label>
      </template>

      <template v-else>
        <fieldset class="checkout__field">
          <legend>配送地址</legend>
          <p class="checkout__hint">配送时间由商家联系确认。</p>
          <ul v-if="addresses.items.length" class="checkout__addresses">
            <li v-for="address in addresses.items" :key="address.id">
              <label class="checkout__radio">
                <input
                  v-model="addressId"
                  type="radio"
                  name="addressId"
                  :value="address.id"
                  :data-testid="`address-${address.id}`"
                />
                <span>
                  <strong>{{ address.recipient }}</strong>
                  {{ address.phone }}
                  <span v-if="address.isDefault" class="checkout__badge">
                    默认
                  </span>
                </span>
                <small>
                  {{ address.province }} {{ address.city }}
                  {{ address.district }}
                  {{ address.detail }}
                </small>
              </label>
            </li>
          </ul>
          <p v-else class="checkout__empty">
            暂无地址,请先在“地址簿”添加收货地址。
          </p>
        </fieldset>
      </template>

      <label class="checkout__field">
        <span>订单备注(可选,最多 {{ REMARK_MAX_LENGTH }} 字)</span>
        <textarea
          v-model="remark"
          rows="3"
          :maxlength="REMARK_MAX_LENGTH"
          placeholder="可填写祝福语或定制需求"
          data-testid="remark"
        />
      </label>

      <p
        v-if="formError"
        class="checkout__error"
        role="alert"
        data-testid="form-error"
      >
        {{ formError }}
      </p>
      <p
        v-else-if="lastError"
        class="checkout__error"
        role="alert"
        data-testid="submit-error"
      >
        {{ lastError }}
      </p>

      <button
        type="submit"
        class="checkout__submit"
        :disabled="!canSubmit"
        data-testid="submit"
      >
        {{
          submitting
            ? '提交中…'
            : `提交订单 · ¥${(cartTotalCents / 100).toFixed(2)}`
        }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.checkout {
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--mall-ink);
}
.checkout__hero h1 {
  color: var(--mall-leaf);
  margin: 0 0 4px;
  font-size: 20px;
}
.checkout__hero p {
  color: var(--mall-muted);
  margin: 0;
  font-size: 13px;
}
.checkout__cart {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 12px 16px;
  box-shadow: 0 1px 3px rgba(143, 181, 143, 0.08);
}
.checkout__cart h2 {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--mall-leaf);
}
.checkout__cart ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.checkout__cart li {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  row-gap: 2px;
  font-size: 13px;
}
.checkout__cart-name {
  grid-column: 1;
  grid-row: 1;
}
.checkout__cart-sku {
  grid-column: 1;
  grid-row: 2;
  color: var(--mall-muted);
  font-size: 12px;
}
.checkout__cart-price {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  color: var(--mall-apricot);
}
.checkout__cart-total {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #e7e2d8;
  font-weight: 500;
}
.checkout__empty {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 16px;
  color: var(--mall-muted);
  font-size: 14px;
  text-align: center;
  margin: 0;
}
.checkout__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.checkout__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 12px 16px;
  border: 0;
  margin: 0;
}
.checkout__field > span,
.checkout__field > legend {
  color: var(--mall-muted);
  font-size: 12px;
}
.checkout__field input,
.checkout__field textarea {
  border: 1px solid #e7e2d8;
  border-radius: var(--van-radius-md);
  padding: 8px 10px;
  font-size: 14px;
  outline: none;
  background: #fff;
  color: var(--mall-ink);
  resize: vertical;
  font-family: inherit;
}
.checkout__field input:focus,
.checkout__field textarea:focus {
  border-color: var(--mall-leaf);
}
.checkout__radio {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  font-size: 14px;
  color: var(--mall-ink);
}
.checkout__radio small {
  display: block;
  color: var(--mall-muted);
  font-size: 12px;
}
.checkout__hint {
  margin: 0 0 6px;
  color: var(--mall-apricot);
  font-size: 12px;
}
.checkout__addresses {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.checkout__badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 12px;
  background: rgba(143, 181, 143, 0.15);
  color: var(--mall-leaf);
  font-size: 11px;
}
.checkout__error {
  margin: 0;
  color: #c14d4d;
  font-size: 13px;
  background: rgba(193, 77, 77, 0.08);
  border-radius: var(--van-radius-md);
  padding: 8px 12px;
}
.checkout__submit {
  height: 48px;
  border-radius: var(--van-radius-lg);
  border: 0;
  background: var(--van-primary-color);
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
}
.checkout__submit[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
