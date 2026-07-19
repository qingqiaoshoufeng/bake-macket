<script setup lang="ts">
import type { OrderView } from '@bake-mall/contracts';

import { FULFILLMENT_LABELS, ORDER_STATUS_LABELS } from '../config/labels.js';
import { formatMoney, formatOrderDate } from '../hooks/formatters.js';

defineProps<{ order: OrderView }>();
defineEmits<{ (event: 'open', order: OrderView): void }>();
</script>

<template>
  <li>
    <button
      class="orders__item"
      type="button"
      :data-testid="`order-${order.id}`"
      @click="$emit('open', order)"
    >
      <span class="orders__item-head">
        <span class="orders__item-no">{{ order.orderNo }}</span>
        <span
          class="store-status-pill"
          :data-status="order.status"
          :data-testid="`order-status-${order.status}`"
          >{{ ORDER_STATUS_LABELS[order.status] }}</span
        >
      </span>
      <span class="orders__item-fulfillment">{{
        FULFILLMENT_LABELS[order.fulfillmentType]
      }}</span>
      <span class="orders__item-items"
        ><span v-for="item in order.items" :key="item.id"
          >{{ item.productName }} · {{ item.skuName }} ×
          {{ item.quantity }}</span
        ></span
      >
      <span class="orders__item-foot"
        ><time>{{ formatOrderDate(order.createdAt) }}</time
        ><span class="orders__item-total">{{
          formatMoney(order.goodsTotalCents)
        }}</span></span
      >
    </button>
  </li>
</template>

<style scoped>
.orders__item {
  display: grid;
  width: 100%;
  gap: var(--mall-space-2);
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.orders__item-head,
.orders__item-foot {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--mall-space-3);
}
.orders__item-no {
  min-width: 0;
  overflow: hidden;
  color: var(--mall-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.store-status-pill {
  padding: 4px 10px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-size: 11px;
  font-weight: 700;
}
.store-status-pill[data-status='CANCELLED'] {
  background: color-mix(
    in srgb,
    var(--mall-text-muted) 10%,
    var(--mall-surface)
  );
  color: var(--mall-text-muted);
}
.store-status-pill[data-status='COMPLETED'] {
  background: color-mix(in srgb, var(--mall-accent) 14%, var(--mall-surface));
  color: #a96836;
}
.store-status-pill[data-status='PROCESSING'] {
  background: color-mix(in srgb, var(--mall-primary) 16%, var(--mall-surface));
}
.orders__item-fulfillment {
  color: var(--mall-text);
  font-size: 15px;
  font-weight: 700;
}
.orders__item-items {
  display: grid;
  gap: var(--mall-space-1);
  margin: 0;
  padding: var(--mall-space-2) 0;
  border-block: 1px dashed var(--mall-border);
  color: var(--mall-text-muted);
  font-size: 13px;
  line-height: 1.6;
}
.orders__item-foot {
  color: var(--mall-text-muted);
  font-size: 12px;
}
.orders__item-total {
  color: var(--mall-accent);
  font-size: 18px;
  font-weight: 700;
}
</style>
