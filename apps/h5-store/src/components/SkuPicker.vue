<script setup lang="ts">
import { computed, ref } from 'vue';
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
  return props.skus.find((sku) => sku.id === selectedSkuId.value) ?? null;
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
            selectedSkuId === sku.id ? 'sku-picker__item--selected' : '',
            !isSelectable(sku) ? 'sku-picker__item--disabled' : '',
          ]"
          :data-testid="`sku-${sku.id}`"
          :disabled="!isSelectable(sku)"
          @click="selectSku(sku)"
        >
          <span class="sku-picker__name">{{ sku.name }}</span>
          <span class="sku-picker__price">¥{{ (sku.priceCents / 100).toFixed(2) }}</span>
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
          data-testid="qty"
          :value="quantity"
          @input="onQuantityInput(Number(($event.target as HTMLInputElement).value))"
          @blur="onQuantityBlur"
        />
      </label>

      <button
        type="button"
        class="sku-picker__add"
        data-testid="add-cart"
        :disabled="!canAdd"
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
  gap: 16px;
}
.sku-picker__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sku-picker__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 14px;
  border-radius: var(--van-radius-md);
  border: 1px solid #e7e2d8;
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 120ms ease,
    background 120ms ease;
  min-width: 110px;
}
.sku-picker__item--selected {
  border-color: var(--mall-leaf);
  background: rgba(143, 181, 143, 0.1);
}
.sku-picker__item--disabled {
  opacity: 0.55;
  cursor: not-allowed;
  background: #f5f0e6;
}
.sku-picker__name {
  font-size: 14px;
  font-weight: 500;
  color: var(--mall-ink);
}
.sku-picker__price {
  font-size: 13px;
  color: var(--mall-apricot);
}
.sku-picker__stock {
  font-size: 12px;
  color: var(--mall-muted);
}
.sku-picker__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sku-picker__qty {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--mall-muted);
}
.sku-picker__qty input {
  width: 64px;
  height: 36px;
  border-radius: var(--van-radius-md);
  border: 1px solid #e7e2d8;
  background: #fff;
  padding: 0 8px;
  font-size: 14px;
  color: var(--mall-ink);
  outline: none;
  text-align: center;
}
.sku-picker__qty input:focus {
  border-color: var(--mall-leaf);
}
.sku-picker__add {
  flex: 1;
  height: 44px;
  border-radius: var(--van-radius-lg);
  border: 0;
  background: var(--van-primary-color);
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
}
.sku-picker__add[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>