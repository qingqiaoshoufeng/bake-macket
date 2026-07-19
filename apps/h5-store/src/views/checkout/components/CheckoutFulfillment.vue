<script setup lang="ts">
import { FulfillmentType } from '@bake-mall/contracts';

import type { AddressView } from '@bake-mall/contracts';

defineProps<{
  fulfillmentType: FulfillmentType;
  pickupTimeText: string;
  addressId: string | null;
  addresses: readonly AddressView[];
}>();

const emit = defineEmits<{
  (event: 'update:fulfillmentType', value: FulfillmentType): void;
  (event: 'update:pickupTimeText', value: string): void;
  (event: 'update:addressId', value: string | null): void;
}>();

function updateMode(event: Event): void {
  emit('update:fulfillmentType', (event.target as HTMLInputElement).value as FulfillmentType);
}

function updatePickupTime(event: Event): void {
  emit('update:pickupTimeText', (event.target as HTMLTextAreaElement).value);
}

function updateAddress(event: Event): void {
  emit('update:addressId', (event.target as HTMLInputElement).value || null);
}
</script>

<template>
  <fieldset class="store-form-card checkout__field">
    <legend class="store-form-card__heading"><span>02</span><strong>履约方式</strong></legend>
    <div class="checkout__radio-grid">
      <label class="checkout__radio">
        <input :checked="fulfillmentType === FulfillmentType.PICKUP" type="radio" name="fulfillmentType" :value="FulfillmentType.PICKUP" data-testid="fulfillment-pickup" @change="updateMode" />
        <span>到店自提</span>
      </label>
      <label class="checkout__radio">
        <input :checked="fulfillmentType === FulfillmentType.DELIVERY" type="radio" name="fulfillmentType" :value="FulfillmentType.DELIVERY" data-testid="fulfillment-delivery" @change="updateMode" />
        <span>同城配送</span>
      </label>
    </div>
  </fieldset>

  <section class="store-form-card checkout__fulfillment-detail">
    <div class="store-form-card__heading"><span>04</span><h2>履约详情</h2></div>
    <label v-if="fulfillmentType === FulfillmentType.PICKUP" class="checkout__control">
      <span>期望取货时间</span>
      <textarea :value="pickupTimeText" rows="3" maxlength="256" placeholder="例如:明天上午十点" data-testid="pickup-time" @input="updatePickupTime" />
    </label>
    <fieldset v-else class="checkout__addresses-field">
      <legend>配送地址</legend>
      <p class="checkout__hint">配送时间由商家联系确认。</p>
      <ul v-if="addresses.length" class="checkout__addresses">
        <li v-for="address in addresses" :key="address.id">
          <label class="checkout__radio checkout__radio--address">
            <input :checked="addressId === address.id" type="radio" name="addressId" :value="address.id" :data-testid="`address-${address.id}`" @change="updateAddress" />
            <span><strong>{{ address.recipient }}</strong> {{ address.phone }} <span v-if="address.isDefault" class="checkout__badge">默认</span><small>{{ address.province }} {{ address.city }} {{ address.district }} {{ address.detail }}</small></span>
          </label>
        </li>
      </ul>
      <p v-else class="checkout__empty">暂无地址,请先在“地址簿”添加收货地址。</p>
    </fieldset>
  </section>
</template>

<style scoped>
.store-form-card { margin: 0; padding: var(--mall-space-4); border: 1px solid var(--mall-border); border-radius: var(--mall-radius-card); background: var(--mall-surface); box-shadow: var(--mall-shadow-card); }
.store-form-card__heading { display: flex; margin: 0 0 var(--mall-space-3); align-items: center; gap: var(--mall-space-2); color: var(--mall-text); }
.store-form-card__heading > span { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 50%; background: var(--mall-surface-soft); color: var(--mall-primary-strong); font-size: 10px; font-weight: 700; }
.store-form-card__heading h2, .store-form-card__heading strong { margin: 0; font-size: 15px; font-weight: 700; }
.checkout__field, .checkout__addresses-field { min-width: 0; }
.checkout__addresses-field { margin: 0; padding: 0; border: 0; }
.checkout__addresses-field > legend, .checkout__control > span { color: var(--mall-text-muted); font-size: 12px; }
.checkout__radio-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--mall-space-2); }
.checkout__radio { display: flex; min-height: 44px; padding: var(--mall-space-2) var(--mall-space-3); align-items: center; gap: var(--mall-space-2); border: 1px solid var(--mall-border); border-radius: var(--mall-radius-control); color: var(--mall-text); font-size: 14px; cursor: pointer; }
.checkout__radio:has(input:checked) { border-color: var(--mall-primary); background: var(--mall-surface-soft); }
.checkout__radio input { width: 18px; height: 18px; margin: 0; accent-color: var(--mall-primary-strong); }
.checkout__radio--address { align-items: flex-start; }
.checkout__radio--address > span { min-width: 0; line-height: 1.5; }
.checkout__radio small { display: block; margin-top: 2px; color: var(--mall-text-muted); font-size: 12px; }
.checkout__addresses { display: grid; gap: var(--mall-space-2); margin: 0; padding: 0; list-style: none; }
.checkout__control { display: grid; gap: var(--mall-space-1); }
.checkout__control textarea { width: 100%; min-height: 88px; padding: var(--mall-space-2) var(--mall-space-3); border: 1px solid var(--mall-border); border-radius: var(--mall-radius-control); outline: none; background: var(--mall-canvas); color: var(--mall-text); font: inherit; font-size: 14px; resize: vertical; }
.checkout__control textarea:focus { border-color: var(--mall-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mall-primary) 14%, transparent); }
.checkout__hint { margin: 0 0 var(--mall-space-2); color: var(--mall-accent); font-size: 12px; }
.checkout__badge { display: inline-block; margin-left: var(--mall-space-1); padding: 1px var(--mall-space-2); border-radius: 999px; background: var(--mall-surface-soft); color: var(--mall-primary-strong); font-size: 11px; }
.checkout__empty { margin: 0; padding: var(--mall-space-4); border: 1px dashed var(--mall-border); border-radius: var(--mall-radius-card); background: var(--mall-surface); color: var(--mall-text-muted); font-size: 14px; text-align: center; }
@media (max-width: 360px) { .checkout__radio-grid { grid-template-columns: 1fr; } }
</style>
