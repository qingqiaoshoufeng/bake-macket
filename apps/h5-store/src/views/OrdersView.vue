<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { OrderStatus, type OrderView } from '@bake-mall/contracts';

import { useOrdersStore } from '../stores/orders.js';

const orders = useOrdersStore();
const router = useRouter();

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

const items = computed<OrderView[]>(() => orders.items);

onMounted(async () => {
  try {
    await orders.refresh();
  } catch {
    showToast('订单加载失败,请稍后重试');
  }
});

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

function openDetail(order: OrderView): void {
  void router.push(`/orders/${order.id}`);
}
</script>

<template>
  <main class="orders">
    <header class="orders__hero">
      <h1>我的订单</h1>
      <p>显示最近创建的订单,包括新订单、处理中、已完成和已取消。</p>
    </header>

    <p v-if="orders.loading && !items.length" class="orders__loading">
      正在加载…
    </p>
    <p v-else-if="!items.length" class="orders__empty">暂无订单,先去下单吧。</p>

    <ul v-else class="orders__list">
      <li
        v-for="order in items"
        :key="order.id"
        class="orders__item"
        :data-testid="`order-${order.id}`"
        @click="openDetail(order)"
      >
        <header class="orders__item-head">
          <span class="orders__item-no">{{ order.orderNo }}</span>
          <span
            class="orders__item-status"
            :data-status="order.status"
            :data-testid="`order-status-${order.status}`"
          >
            {{ STATUS_LABELS[order.status] }}
          </span>
        </header>
        <div class="orders__item-fulfillment">
          {{ FULFILLMENT_LABELS[order.fulfillmentType] }}
        </div>
        <ul class="orders__item-items">
          <li v-for="item in order.items" :key="item.id">
            {{ item.productName }} · {{ item.skuName }} × {{ item.quantity }}
          </li>
        </ul>
        <footer class="orders__item-foot">
          <time>{{ formatDate(order.createdAt) }}</time>
          <span class="orders__item-total">{{
            formatTotal(order.goodsTotalCents)
          }}</span>
        </footer>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.orders {
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--mall-ink);
}
.orders__hero h1 {
  color: var(--mall-leaf);
  margin: 0 0 4px;
  font-size: 20px;
}
.orders__hero p {
  margin: 0;
  color: var(--mall-muted);
  font-size: 13px;
}
.orders__loading,
.orders__empty {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 24px;
  text-align: center;
  color: var(--mall-muted);
  font-size: 14px;
  margin: 0;
}
.orders__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.orders__item {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 12px 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 1px 3px rgba(143, 181, 143, 0.08);
}
.orders__item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.orders__item-no {
  font-size: 13px;
  color: var(--mall-muted);
}
.orders__item-status {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 12px;
  background: rgba(143, 181, 143, 0.15);
  color: var(--mall-leaf);
}
.orders__item-status[data-status='CANCELLED'] {
  background: rgba(140, 140, 140, 0.15);
  color: #6f6a63;
}
.orders__item-status[data-status='COMPLETED'] {
  background: rgba(242, 201, 157, 0.18);
  color: var(--mall-apricot);
}
.orders__item-status[data-status='PROCESSING'] {
  background: rgba(125, 167, 125, 0.18);
  color: var(--mall-leaf);
}
.orders__item-fulfillment {
  font-size: 14px;
  color: var(--mall-ink);
}
.orders__item-items {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 13px;
  color: var(--mall-muted);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.orders__item-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--mall-muted);
}
.orders__item-total {
  color: var(--mall-apricot);
  font-size: 14px;
  font-weight: 500;
}
</style>
