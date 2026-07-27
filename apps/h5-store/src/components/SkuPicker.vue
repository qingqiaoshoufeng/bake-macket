<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SkuView } from '@bake-mall/contracts';

/**
 * SKU picker used by `ProductDetailView`.
 *
 * The user must explicitly choose a SKU before the add-to-cart action is
 * enabled. SKUs that are flagged unavailable on the server (`isAvailable`
 * `false`) or that have no stock render as a disabled button so the user can
 * tell why they cannot pick that variant. The chosen SKU's quantity defaults
 * to 1 and is clamped to `[1, 99]` on blur — `CartItem` rows are bounded the
 * same way by the API (`UpsertCartItemDto.quantity`).
 *
 * `add` is emitted exactly once per press and only when the chosen SKU is
 * sellable; otherwise the button is `disabled` and clicks are swallowed.
 */

const props = defineProps<{
  skus: SkuView[];
}>();

const emit = defineEmits<{
  (event: 'add', payload: { skuId: string; quantity: number }): void;
}>();

const selectedSkuId = ref<string | null>(null);
const quantity = ref(1);

const selectedSku = computed<SkuView | null>(() => {
  if (!selectedSkuId.value) return null;
  const sku = props.skus.find(({ id }) => id === selectedSkuId.value);
  return sku && isSelectable(sku) ? sku : null;
});

watch(selectedSku, (sku) => {
  if (!sku) selectedSkuId.value = null;
});

const canAdd = computed(() => {
  const sku = selectedSku.value;
  if (!sku) return false;
  if (!sku.isAvailable) return false;
  if (sku.stock <= 0) return false;
  return quantity.value >= 1 && quantity.value <= 99;
});

function isSelectable(sku: SkuView): boolean {
  return sku.isAvailable && sku.stock > 0;
}

function selectSku(sku: SkuView): void {
  if (!isSelectable(sku)) return;
  selectedSkuId.value = sku.id;
}

function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 1) return 1;
  if (value > 99) return 99;
  return Math.floor(value);
}

function onQuantityInput(value: number | string): void {
  const parsed = typeof value === 'string' ? Number(value) : value;
  quantity.value = clampQuantity(parsed);
}

function onQuantityBlur(): void {
  quantity.value = clampQuantity(quantity.value);
}

function onAdd(): void {
  if (!canAdd.value || !selectedSku.value) return;
  emit('add', {
    skuId: selectedSku.value.id,
    quantity: clampQuantity(quantity.value),
  });
}
</script>

<template>
  <section class="sku-picker">
    <ul class="sku-picker__list" role="list">
      <li v-for="sku in skus" :key="sku.id">
        <button
          type="button"
          :class="[
            'sku-picker__item',
            selectedSku?.id === sku.id ? 'sku-picker__item--selected' : '',
            !isSelectable(sku) ? 'sku-picker__item--disabled' : '',
          ]"
          :data-testid="`sku-${sku.id}`"
          :disabled="!isSelectable(sku)"
          @click="selectSku(sku)"
        >
          <span class="sku-picker__name">{{ sku.name }}</span>
          <span class="sku-picker__price"
            >¥{{ (sku.priceCents / 100).toFixed(2) }}</span
          >
          <span class="sku-picker__stock">
            <template v-if="!sku.isAvailable">已下架</template>
            <template v-else-if="sku.stock <= 0">暂时缺货</template>
            <template v-else>库存 {{ sku.stock }}</template>
          </span>
        </button>
      </li>
    </ul>

    <div class="sku-picker__row">
      <label class="sku-picker__qty">
        <span>数量</span>
        <input
          type="number"
          inputmode="numeric"
          min="1"
          max="99"
          step="1"
          class="sku-picker__qty-input"
          data-testid="qty"
          :value="quantity"
          @input="
            onQuantityInput(Number(($event.target as HTMLInputElement).value))
          "
          @blur="onQuantityBlur"
        />
      </label>

      <button
        type="button"
        class="sku-picker__add"
        data-testid="add-cart"
        :disabled="!canAdd"
        :aria-disabled="!canAdd"
        @click="onAdd"
      >
        加入购物车
      </button>
    </div>
  </section>
</template>

<style scoped>
.sku-picker {
  display: flex;
  flex-direction: column;
  gap: var(--mall-space-5);
}

.sku-picker__list {
  display: grid;
  margin: 0;
  padding: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mall-space-2);
  list-style: none;
}

.sku-picker__item {
  display: flex;
  width: 100%;
  min-height: 82px;
  padding: var(--mall-space-3);
  flex-direction: column;
  align-items: flex-start;
  gap: var(--mall-space-1);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  color: var(--mall-text);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    box-shadow 120ms ease;
}

.sku-picker__item--selected {
  border-color: var(--mall-primary);
  background: var(--mall-surface-soft);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--mall-primary) 14%, transparent);
}

.sku-picker__item--disabled {
  background: color-mix(in srgb, var(--mall-canvas) 76%, var(--mall-surface));
  cursor: not-allowed;
  opacity: 0.58;
}

.sku-picker__name {
  font-size: 14px;
  font-weight: 600;
}

.sku-picker__price {
  color: var(--mall-accent);
  font-size: 13px;
  font-weight: 600;
}

.sku-picker__stock {
  color: var(--mall-text-muted);
  font-size: 12px;
}

.sku-picker__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mall-space-3);
}

.sku-picker__qty {
  display: flex;
  align-items: center;
  gap: var(--mall-space-2);
  color: var(--mall-text-muted);
  font-size: 14px;
}

.sku-picker__qty-input {
  width: 64px;
  height: 44px;
  padding: 0 var(--mall-space-2);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-control);
  outline: none;
  background: var(--mall-surface);
  color: var(--mall-text);
  font: inherit;
  text-align: center;
}

.sku-picker__qty-input:focus {
  border-color: var(--mall-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--mall-primary) 12%, transparent);
}

.sku-picker__add {
  min-width: 0;
  height: 46px;
  padding: 0 var(--mall-space-4);
  flex: 1;
  border: 0;
  border-radius: var(--mall-radius-card);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.sku-picker__add[disabled] {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 360px) {
  .sku-picker__row {
    align-items: stretch;
    flex-direction: column;
  }

  .sku-picker__add {
    flex: 0 0 46px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sku-picker__item {
    transition: none;
  }
}
</style>
