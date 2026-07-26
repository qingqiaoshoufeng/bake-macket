<script setup lang="ts">
import { Stepper } from 'vant';

import type { CartItemView } from '@bake-mall/contracts';

const props = defineProps<{
  item: CartItemView;
  invalidLabel: string;
  selected: boolean;
}>();

const emit = defineEmits<{
  (event: 'select', id: string, selected: boolean): void;
  (event: 'quantity', id: string, quantity: number): void;
  (event: 'remove', id: string): void;
}>();

function updateSelection(event: Event): void {
  emit(
    'select',
    props.item.id,
    (event.currentTarget as HTMLInputElement).checked,
  );
}

function updateQuantity(value: number | string): void {
  emit('quantity', props.item.id, Number(value));
}
</script>

<template>
  <li
    :class="[
      'cart-row',
      selected && item.available && 'is-selected',
      !item.available && 'is-invalid',
    ]"
  >
    <label class="cart-row__select">
      <input
        data-testid="cart-item-select"
        type="checkbox"
        :checked="selected"
        :disabled="!item.available"
        :aria-label="`选择${item.product.name || '失效商品'}`"
        @change="updateSelection"
      />
      <span class="cart-row__select-mark" aria-hidden="true" />
    </label>

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
        <div class="cart-row__stepper cart-row__stepper--polished">
          <Stepper
            :model-value="item.quantity"
            :min="1"
            :max="99"
            :disabled="!item.available"
            integer
            @update:model-value="updateQuantity"
          />
        </div>
        <button
          class="cart-row__remove"
          type="button"
          @click="emit('remove', item.id)"
        >
          移除
        </button>
      </div>
    </div>
  </li>
</template>

<style scoped>
.cart-row {
  display: grid;
  min-width: 0;
  grid-template-columns: 36px 84px minmax(0, 1fr);
  gap: var(--mall-space-3);
  padding: var(--mall-space-3);
  align-items: stretch;
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.cart-row.is-selected {
  border-color: color-mix(in srgb, var(--mall-primary) 40%, var(--mall-border));
}

.cart-row.is-invalid {
  opacity: 0.64;
  filter: grayscale(0.25);
}

.cart-row__select {
  display: grid;
  width: 36px;
  min-height: 44px;
  align-self: center;
  cursor: pointer;
  place-items: center;
}

.cart-row__select input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
}

.cart-row__select-mark {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1.5px solid var(--mall-border);
  border-radius: 50%;
  background: var(--mall-surface);
  box-shadow: inset 0 0 0 3px var(--mall-surface);
  transition:
    background 160ms ease,
    border-color 160ms ease,
    transform 160ms ease;
}

.cart-row__select input:checked + .cart-row__select-mark {
  border-color: var(--mall-primary);
  background: var(--mall-primary);
}

.cart-row__select input:checked + .cart-row__select-mark::after {
  width: 8px;
  height: 4px;
  border-bottom: 2px solid #fff;
  border-left: 2px solid #fff;
  content: '';
  transform: translateY(-1px) rotate(-45deg);
}

.cart-row__select input:focus-visible + .cart-row__select-mark {
  outline: 3px solid color-mix(in srgb, var(--mall-primary) 24%, transparent);
  outline-offset: 2px;
}

.cart-row__select input:disabled + .cart-row__select-mark {
  border-style: dashed;
  background: var(--mall-canvas);
}

.cart-row__image {
  display: grid;
  min-height: 112px;
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
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.cart-row__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mall-space-2);
}

.cart-row h2 {
  display: -webkit-box;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--mall-text);
  font-size: 15px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
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
  overflow: hidden;
  color: var(--mall-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cart-row__body > strong {
  color: var(--mall-accent);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.cart-row__actions {
  display: flex;
  min-width: 0;
  margin-top: auto;
  padding-top: var(--mall-space-2);
  align-items: center;
  justify-content: space-between;
  gap: var(--mall-space-2);
  flex-wrap: wrap;
}

.cart-row__stepper {
  display: flex;
  min-width: 0;
  height: 38px;
  padding: 0 3px;
  flex: 0 0 auto;
  align-items: center;
  border: 1px solid
    color-mix(in srgb, var(--mall-primary) 16%, var(--mall-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--mall-surface-soft) 58%, #fff);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 82%);
}

.cart-row__stepper :deep(.van-stepper) {
  display: grid;
  height: 44px;
  grid-template-columns: 44px 32px 44px;
  align-items: center;
  font: inherit;
}

.cart-row__stepper :deep(.van-stepper__minus),
.cart-row__stepper :deep(.van-stepper__plus) {
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  appearance: none;
  background: radial-gradient(
    circle at center,
    var(--mall-surface) 0 15px,
    transparent 15.5px
  );
  color: var(--mall-primary-strong);
  box-shadow: none;
}

.cart-row__stepper :deep(.van-stepper__input) {
  width: 32px;
  height: 36px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  appearance: none;
  background: transparent;
  color: var(--mall-text);
  font: inherit;
  text-align: center;
  outline: none;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.cart-row__stepper :deep(.van-stepper__minus::before),
.cart-row__stepper :deep(.van-stepper__plus::before),
.cart-row__stepper :deep(.van-stepper__plus::after) {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 1.5px;
  border-radius: 999px;
  background: currentcolor;
  content: '';
  transform: translate(-50%, -50%);
}

.cart-row__stepper :deep(.van-stepper__minus),
.cart-row__stepper :deep(.van-stepper__plus) {
  position: relative;
}

.cart-row__stepper :deep(.van-stepper__plus::after) {
  transform: translate(-50%, -50%) rotate(90deg);
}

.cart-row__stepper :deep(.van-stepper__minus:focus-visible),
.cart-row__stepper :deep(.van-stepper__plus:focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--mall-primary) 32%, transparent);
  outline-offset: -6px;
}

.cart-row__stepper :deep(.van-stepper__minus--disabled),
.cart-row__stepper :deep(.van-stepper__plus--disabled) {
  color: var(--mall-text-muted);
  opacity: 0.48;
}

.cart-row__remove {
  min-width: 44px;
  min-height: 44px;
  margin-left: auto;
  padding: 0 var(--mall-space-2);
  border: 0;
  border-radius: var(--mall-radius-control);
  background: transparent;
  color: var(--mall-text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cart-row__remove:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--mall-primary) 24%, transparent);
  outline-offset: 1px;
}

@media (max-width: 390px) {
  .cart-row {
    grid-template-columns: 32px 76px minmax(0, 1fr);
    gap: var(--mall-space-2);
  }

  .cart-row__select {
    width: 32px;
  }

  .cart-row__actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .cart-row__remove {
    width: 100%;
    min-height: 36px;
    margin-left: 0;
    text-align: left;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cart-row,
  .cart-row__select-mark {
    transition: none;
  }
}
</style>
