<script setup lang="ts">
import type { OrderView } from '@bake-mall/contracts';

import { FULFILLMENT_LABELS, ORDER_STATUS_LABELS } from '../config/labels.js';
import { formatMoney, formatOrderDate, formatSkuAttributes } from '../hooks/formatters.js';

defineProps<{ order: OrderView }>();
</script>

<template>
  <header class="order-detail__hero">
    <span class="store-status-pill" :data-status="order.status" data-testid="order-status">{{ ORDER_STATUS_LABELS[order.status] }}</span>
    <p class="order-detail__eyebrow">订单编号</p><h1>{{ order.orderNo }}</h1><p>下单时间:{{ formatOrderDate(order.createdAt) }}</p>
  </header>
  <section class="order-detail__section"><h2>履约信息</h2><p><strong>{{ FULFILLMENT_LABELS[order.fulfillmentType] }}</strong></p><p v-if="order.fulfillmentType === 'DELIVERY'">{{ order.deliveryAddressText ?? '—' }}</p><p v-if="order.fulfillmentType === 'PICKUP'">期望取货时间:{{ order.pickupTimeText ?? '—' }}</p></section>
  <section class="order-detail__section"><h2>联系人</h2><p>{{ order.contactName }} · {{ order.contactPhone }}</p></section>
  <section v-if="order.remark" class="order-detail__section"><h2>订单备注</h2><p>{{ order.remark }}</p></section>
  <section class="order-detail__section order-detail__section--items">
    <h2>商品清单</h2>
    <ul class="order-detail__items"><li v-for="item in order.items" :key="item.id"><div class="order-detail__item-name">{{ item.productName }}</div><div class="order-detail__item-sku">{{ item.skuName }} <span v-if="formatSkuAttributes(item.skuAttributes)">({{ formatSkuAttributes(item.skuAttributes) }})</span></div><div class="order-detail__item-row"><span>单价 {{ formatMoney(item.unitPriceCents) }}</span><span>× {{ item.quantity }}</span></div></li></ul>
    <p class="order-detail__total"><span>合计</span><span>{{ formatMoney(order.goodsTotalCents) }}</span></p>
  </section>
</template>

<style scoped>
.order-detail__hero, .order-detail__section { padding: var(--mall-space-4); border: 1px solid var(--mall-border); border-radius: var(--mall-radius-card); background: var(--mall-surface); box-shadow: var(--mall-shadow-card); }
.order-detail__hero { position: relative; overflow: hidden; background: linear-gradient(135deg, var(--mall-surface-soft), var(--mall-surface)); }
.order-detail__hero::after { position: absolute; right: -12px; bottom: -12px; color: rgb(255 255 255 / 78%); content: 'ORDER'; font-size: 38px; font-weight: 800; letter-spacing: -0.08em; line-height: 1; }
.store-status-pill { position: relative; z-index: 1; display: inline-block; padding: 4px 10px; border-radius: 999px; background: var(--mall-surface); color: var(--mall-primary-strong); font-size: 11px; font-weight: 700; }
.store-status-pill[data-status='CANCELLED'] { color: var(--mall-text-muted); }
.store-status-pill[data-status='COMPLETED'] { color: #a96836; }
.order-detail__eyebrow { margin-top: var(--mall-space-4) !important; color: var(--mall-primary-strong) !important; font-size: 10px !important; font-weight: 700; letter-spacing: 0.14em; }
.order-detail__hero h1 { position: relative; z-index: 1; margin: var(--mall-space-1) 0; overflow-wrap: anywhere; color: var(--mall-text); font-size: 20px; }
.order-detail__hero p, .order-detail__section p { position: relative; z-index: 1; margin: 0; color: var(--mall-text-muted); font-size: 13px; line-height: 1.65; }
.order-detail__section h2 { margin: 0 0 var(--mall-space-2); color: var(--mall-primary-strong); font-size: 13px; letter-spacing: 0.04em; }
.order-detail__section strong { color: var(--mall-text); }
.order-detail__items { display: grid; gap: var(--mall-space-3); margin: 0; padding: 0; list-style: none; }
.order-detail__items li { padding-bottom: var(--mall-space-3); border-bottom: 1px dashed var(--mall-border); }
.order-detail__items li:last-child { padding-bottom: 0; border-bottom: 0; }
.order-detail__item-name { color: var(--mall-text); font-size: 14px; font-weight: 700; }
.order-detail__item-sku { margin-top: 2px; color: var(--mall-text-muted); font-size: 12px; }
.order-detail__item-row, .order-detail__total { display: flex; justify-content: space-between; gap: var(--mall-space-3); }
.order-detail__item-row { margin-top: var(--mall-space-2); color: var(--mall-text); font-size: 13px; }
.order-detail__total { margin-top: var(--mall-space-3) !important; padding-top: var(--mall-space-3); align-items: baseline; border-top: 1px solid var(--mall-border); color: var(--mall-text) !important; font-weight: 700; }
.order-detail__total span:last-child { color: var(--mall-accent); font-size: 20px; }
</style>
