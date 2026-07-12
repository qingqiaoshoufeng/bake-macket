<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { OrderStatus, type OrderView } from '@bake-mall/contracts';

import { useOrdersStore } from '../stores/orders.js';

const route = useRoute();
const router = useRouter();
const orders = useOrdersStore();

const STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.NEW]: '新订单',
  [OrderStatus.PROCESSING]: '处理中',
  [OrderStatus.COMPLETED]: '已完成',
  [OrderStatus.CANCELLED]: '已取消',
};

const FULFILLMENT_LABELS: Record<'PICKUP' | 'DELIVERY', string> = {
  PICKUP: '到店自提',
  DELIVERY: '同城配送',
};

const order = computed<OrderView | null>(() => orders.current);

async function load(id: string): Promise<void> {
  try {
    await orders.loadOne(id);
  } catch {
    showToast('订单加载失败');
  }
}

onMounted(() => {
  const id = String(route.params.id ?? '');
  if (id) void load(id);
});

watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string' && id) void load(id);
  },
);

function formatTotal(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatAttributes(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}:${value}`)
    .join(' / ');
}

function back(): void {
  void router.push('/orders');
}
</script>

<template>
  <main class="order-detail">
    <button type="button" class="order-detail__back" @click="back">
      ← 返回订单列表
    </button>

    <p v-if="!order" class="order-detail__loading">正在加载…</p>

    <template v-else>
      <header class="order-detail__hero">
        <span
          class="order-detail__status"
          :data-status="order.status"
          data-testid="order-status"
        >
          {{ STATUS_LABELS[order.status] }}
        </span>
        <h1>{{ order.orderNo }}</h1>
        <p>下单时间:{{ formatDate(order.createdAt) }}</p>
      </header>

      <section class="order-detail__section">
        <h2>履约信息</h2>
        <p>
          <strong>{{ FULFILLMENT_LABELS[order.fulfillmentType] }}</strong>
        </p>
        <p v-if="order.fulfillmentType === 'DELIVERY'">
          {{ order.deliveryAddressText ?? '—' }}
        </p>
        <p v-if="order.fulfillmentType === 'PICKUP'">
          期望取货时间:{{ order.pickupTimeText ?? '—' }}
        </p>
      </section>

      <section class="order-detail__section">
        <h2>联系人</h2>
        <p>{{ order.contactName }} · {{ order.contactPhone }}</p>
      </section>

      <section v-if="order.remark" class="order-detail__section">
        <h2>订单备注</h2>
        <p>{{ order.remark }}</p>
      </section>

      <section class="order-detail__section">
        <h2>商品清单</h2>
        <ul class="order-detail__items">
          <li v-for="item in order.items" :key="item.id">
            <div class="order-detail__item-name">
              {{ item.productName }}
            </div>
            <div class="order-detail__item-sku">
              {{ item.skuName }}
              <span v-if="formatAttributes(item.skuAttributes)">
                ({{ formatAttributes(item.skuAttributes) }})
              </span>
            </div>
            <div class="order-detail__item-row">
              <span>单价 {{ formatTotal(item.unitPriceCents) }}</span>
              <span>× {{ item.quantity }}</span>
            </div>
          </li>
        </ul>
        <p class="order-detail__total">
          <span>合计</span>
          <span>{{ formatTotal(order.goodsTotalCents) }}</span>
        </p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.order-detail {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--mall-ink);
}
.order-detail__back {
  background: transparent;
  border: 0;
  padding: 0;
  font-size: 13px;
  color: var(--mall-muted);
  cursor: pointer;
  align-self: flex-start;
}
.order-detail__loading {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 24px;
  text-align: center;
  color: var(--mall-muted);
}
.order-detail__hero {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 16px;
  box-shadow: 0 1px 3px rgba(143, 181, 143, 0.08);
}
.order-detail__hero h1 {
  margin: 8px 0 4px;
  font-size: 18px;
  color: var(--mall-ink);
}
.order-detail__hero p {
  margin: 0;
  color: var(--mall-muted);
  font-size: 12px;
}
.order-detail__status {
  display: inline-block;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 12px;
  background: rgba(143, 181, 143, 0.15);
  color: var(--mall-leaf);
}
.order-detail__status[data-status='CANCELLED'] {
  background: rgba(140, 140, 140, 0.15);
  color: #6f6a63;
}
.order-detail__status[data-status='COMPLETED'] {
  background: rgba(242, 201, 157, 0.18);
  color: var(--mall-apricot);
}
.order-detail__status[data-status='PROCESSING'] {
  background: rgba(125, 167, 125, 0.18);
  color: var(--mall-leaf);
}
.order-detail__section {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.order-detail__section h2 {
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--mall-leaf);
}
.order-detail__section p {
  margin: 0;
  font-size: 14px;
}
.order-detail__items {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.order-detail__items li {
  border-bottom: 1px dashed #e7e2d8;
  padding-bottom: 8px;
}
.order-detail__items li:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.order-detail__item-name {
  font-size: 14px;
  color: var(--mall-ink);
}
.order-detail__item-sku {
  font-size: 12px;
  color: var(--mall-muted);
}
.order-detail__item-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--mall-ink);
}
.order-detail__total {
  display: flex;
  justify-content: space-between;
  font-weight: 500;
  margin-top: 8px;
}
</style>
