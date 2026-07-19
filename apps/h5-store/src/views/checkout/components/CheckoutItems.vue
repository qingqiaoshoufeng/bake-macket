<script setup lang="ts">
import type { CartItemView } from '@bake-mall/contracts';

defineProps<{
  items: readonly CartItemView[];
  totalCents: number;
}>();
</script>

<template>
  <section v-if="items.length" class="store-form-card checkout__cart">
    <div class="store-form-card__heading">
      <span>01</span>
      <h2>商品清单</h2>
    </div>
    <ul>
      <li v-for="item in items" :key="item.id">
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
      <span>合计</span><span>¥{{ (totalCents / 100).toFixed(2) }}</span>
    </div>
  </section>
  <p v-else class="checkout__empty">购物车为空,请先添加商品。</p>
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
.store-form-card__heading {
  display: flex;
  margin: 0 0 var(--mall-space-3);
  align-items: center;
  gap: var(--mall-space-2);
  color: var(--mall-text);
}
.store-form-card__heading > span {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 50%;
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
}
.store-form-card__heading h2 {
  margin: 0;
  font-size: 15px;
}
ul {
  display: grid;
  gap: var(--mall-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: var(--mall-space-3);
  font-size: 13px;
}
.checkout__cart-name {
  min-width: 0;
  grid-column: 1;
  grid-row: 1;
  overflow: hidden;
  color: var(--mall-text);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.checkout__cart-sku {
  grid-column: 1;
  grid-row: 2;
  color: var(--mall-text-muted);
  font-size: 12px;
}
.checkout__cart-price {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  color: var(--mall-accent);
  font-weight: 700;
}
.checkout__cart-total {
  display: flex;
  margin-top: var(--mall-space-3);
  padding-top: var(--mall-space-3);
  justify-content: space-between;
  border-top: 1px dashed var(--mall-border);
  font-weight: 700;
}
.checkout__cart-total span:last-child {
  color: var(--mall-accent);
  font-size: 18px;
}
.checkout__empty {
  margin: 0;
  padding: var(--mall-space-4);
  border: 1px dashed var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  color: var(--mall-text-muted);
  font-size: 14px;
  text-align: center;
}
</style>
