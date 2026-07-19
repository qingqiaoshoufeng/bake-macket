<script setup lang="ts">
import { Stepper } from 'vant';

import type { CartItemView } from '@bake-mall/contracts';

const props = defineProps<{
  item: CartItemView;
  invalidLabel: string;
}>();

const emit = defineEmits<{
  (event: 'quantity', id: string, quantity: number): void;
  (event: 'remove', id: string): void;
}>();

function updateQuantity(value: number | string): void {
  emit('quantity', props.item.id, Number(value));
}
</script>

<template>
  <li :class="['cart-row', !item.available && 'is-invalid']">
    <div class="cart-row__image">
      <img
        v-if="item.product.coverImageUrl"
        :src="item.product.coverImageUrl"
        :alt="item.product.name"
      />
      <span v-else>{{ item.product.name.slice(0, 1) || '烘' }}</span>
    </div>
    <div class="cart-row__body">
      <div class="cart-row__title">
        <h2>{{ item.product.name || '商品已下架' }}</h2>
        <em v-if="!item.available">{{ invalidLabel }}</em>
      </div>
      <p>{{ item.sku.name }}</p>
      <strong>¥{{ (item.sku.priceCents / 100).toFixed(2) }}</strong>
      <div class="cart-row__actions">
        <div class="cart-row__stepper cart-row__stepper--touch-target">
          <Stepper
            :model-value="item.quantity"
            :min="1"
            :max="99"
            :disabled="!item.available"
            @update:model-value="updateQuantity"
          />
        </div>
        <button type="button" @click="emit('remove', item.id)">移除</button>
      </div>
    </div>
  </li>
</template>

<style scoped>
.cart-row {
  display: grid;
  min-width: 0;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: var(--mall-space-3);
  padding: var(--mall-space-3);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}

.cart-row.is-invalid {
  opacity: 0.64;
  filter: grayscale(0.25);
}

.cart-row__image {
  display: grid;
  min-height: 108px;
  overflow: hidden;
  place-items: center;
  border-radius: var(--mall-radius-control);
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-size: 24px;
  font-weight: 700;
}

.cart-row__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cart-row__body {
  min-width: 0;
}
.cart-row__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mall-space-2);
}
.cart-row h2 {
  min-width: 0;
  margin: 0;
  color: var(--mall-text);
  font-size: 15px;
  line-height: 1.4;
}
.cart-row em {
  padding: 3px 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mall-warning) 12%, var(--mall-surface));
  color: var(--mall-warning);
  font-size: 10px;
  font-style: normal;
}
.cart-row__body > p {
  margin: var(--mall-space-1) 0;
  color: var(--mall-text-muted);
  font-size: 12px;
}
.cart-row__body > strong {
  color: var(--mall-accent);
  font-size: 16px;
}
.cart-row__actions {
  display: flex;
  min-width: 0;
  margin-top: var(--mall-space-2);
  align-items: center;
  justify-content: space-between;
  gap: var(--mall-space-2);
}
.cart-row__stepper {
  max-width: 132px;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--mall-radius-control);
}
.cart-row__stepper :deep(.van-stepper__input) {
  width: 34px;
  margin: 0 2px;
  border-radius: 6px;
  background: var(--mall-canvas);
}
.cart-row__stepper--touch-target :deep(.van-stepper__minus),
.cart-row__stepper--touch-target :deep(.van-stepper__plus) {
  width: 44px;
  height: 44px;
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
}
.cart-row__actions > button {
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--mall-space-2);
  border: 0;
  background: transparent;
  color: var(--mall-text-muted);
  font: inherit;
  cursor: pointer;
}
@media (max-width: 360px) {
  .cart-row {
    grid-template-columns: 78px minmax(0, 1fr);
  }
}
</style>
