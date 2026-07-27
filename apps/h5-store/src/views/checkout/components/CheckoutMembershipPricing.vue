<script setup lang="ts">
import type { OrderQuoteView } from '@bake-mall/contracts';
import type { DeepReadonly } from 'vue';

import { formatMoney } from '../../../utils/money.js';

const props = defineProps<{
  quote: DeepReadonly<OrderQuoteView> | null;
  creditText: string;
  loading: boolean;
  validationError: string | null;
  quoteError: string | null;
  requiresConfirmation: boolean;
}>();
const emit = defineEmits<{
  (event: 'update:credit-text', value: string): void;
  (event: 'confirm'): void;
}>();

function updateCredit(event: Event): void {
  emit('update:credit-text', (event.target as HTMLInputElement).value);
}

function discountText(basisPoints: number): string {
  return `${basisPoints / 1000} 折`;
}
</script>

<template>
  <section
    class="store-form-card checkout-pricing"
    aria-labelledby="pricing-title"
  >
    <div class="store-form-card__heading">
      <span>04</span>
      <div>
        <h2 id="pricing-title">会员优惠</h2>
        <p v-if="props.quote?.membership">
          {{ props.quote.membership.name }} ·
          {{ discountText(props.quote.membership.discountBasisPoints) }}
        </p>
        <p v-else>未使用会员折扣</p>
      </div>
    </div>

    <dl v-if="props.quote" class="checkout-pricing__summary">
      <div>
        <dt>商品原价</dt>
        <dd>{{ formatMoney(props.quote.goodsTotalCents) }}</dd>
      </div>
      <div v-if="props.quote.membershipDiscountCents > 0">
        <dt>会员优惠</dt>
        <dd>-{{ formatMoney(props.quote.membershipDiscountCents) }}</dd>
      </div>
      <div>
        <dt>当前消费金</dt>
        <dd>{{ formatMoney(props.quote.availableCreditCents) }}</dd>
      </div>
    </dl>

    <label class="checkout-pricing__control">
      <span>消费金抵扣（元）</span>
      <input
        :value="props.creditText"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        data-testid="credit-input"
        aria-describedby="credit-hint credit-error"
        @input="updateCredit"
      />
    </label>
    <p v-if="props.quote" id="credit-hint" class="checkout-pricing__hint">
      最多可抵扣
      {{ formatMoney(props.quote.maxCreditCents) }}，实际抵扣以最新报价为准
    </p>
    <p
      v-if="props.validationError || props.quoteError"
      id="credit-error"
      class="checkout-pricing__error"
      role="alert"
    >
      {{ props.validationError ?? props.quoteError }}
    </p>
    <p v-if="props.loading" class="checkout-pricing__loading" role="status">
      正在更新报价…
    </p>

    <dl v-if="props.quote" class="checkout-pricing__total">
      <div v-if="props.quote.creditAppliedCents > 0">
        <dt>消费金抵扣</dt>
        <dd>-{{ formatMoney(props.quote.creditAppliedCents) }}</dd>
      </div>
      <div>
        <dt>应付金额</dt>
        <dd>{{ formatMoney(props.quote.payableTotalCents) }}</dd>
      </div>
    </dl>

    <button
      v-if="props.requiresConfirmation && props.quote"
      class="checkout-pricing__confirm"
      type="button"
      data-testid="confirm-quote"
      @click="emit('confirm')"
    >
      确认最新金额
    </button>
  </section>
</template>

<style scoped>
.store-form-card {
  margin: 0;
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.checkout-pricing {
  display: grid;
  min-width: 0;
  gap: var(--mall-space-3);
}
.store-form-card__heading {
  display: flex;
  align-items: center;
  gap: var(--mall-space-2);
}
.store-form-card__heading > span {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
}
.store-form-card__heading h2,
.store-form-card__heading p {
  margin: 0;
}
.store-form-card__heading h2 {
  color: var(--mall-text);
  font-size: 15px;
}
.store-form-card__heading p {
  margin-top: 2px;
  color: var(--mall-text-muted);
  font-size: 12px;
}
.checkout-pricing__summary,
.checkout-pricing__total {
  display: grid;
  gap: var(--mall-space-2);
  margin: 0;
}
.checkout-pricing__summary div,
.checkout-pricing__total div {
  display: flex;
  justify-content: space-between;
  gap: var(--mall-space-3);
}
.checkout-pricing dt,
.checkout-pricing dd {
  margin: 0;
}
.checkout-pricing dt {
  color: var(--mall-text-muted);
  font-size: 13px;
}
.checkout-pricing dd {
  color: var(--mall-text);
  font-size: 13px;
  font-weight: 700;
}
.checkout-pricing__control {
  display: grid;
  gap: var(--mall-space-1);
}
.checkout-pricing__control span,
.checkout-pricing__hint,
.checkout-pricing__loading {
  color: var(--mall-text-muted);
  font-size: 12px;
}
.checkout-pricing__control input {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 0 var(--mall-space-3);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-control);
  outline: none;
  background: var(--mall-canvas);
  color: var(--mall-text);
  font: inherit;
}
.checkout-pricing__control input:focus-visible {
  border-color: var(--mall-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mall-primary) 14%, transparent);
}
.checkout-pricing__hint,
.checkout-pricing__error,
.checkout-pricing__loading {
  margin: 0;
  line-height: 1.5;
}
.checkout-pricing__error {
  color: var(--mall-danger);
  font-size: 13px;
}
.checkout-pricing__total {
  padding-top: var(--mall-space-3);
  border-top: 1px dashed var(--mall-border);
}
.checkout-pricing__total div:last-child dd {
  color: var(--mall-accent);
  font-size: 20px;
}
.checkout-pricing__confirm {
  min-height: 44px;
  padding: 0 var(--mall-space-4);
  border: 1px solid var(--mall-primary);
  border-radius: var(--mall-radius-control);
  background: var(--mall-surface);
  color: var(--mall-primary-strong);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.checkout-pricing__confirm:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--mall-primary) 28%, transparent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .checkout-pricing__confirm,
  .checkout-pricing__control input {
    transition: none;
  }
}
</style>
