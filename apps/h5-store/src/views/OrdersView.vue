<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import type { OrderView } from '@bake-mall/contracts';

import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import StorePage from '../components/layout/StorePage.vue';
import StorePageHeader from '../components/layout/StorePageHeader.vue';
import StoreTabbar from './catalog/components/StoreTabbar.vue';
import { OrderCard, useOrderList } from './orders/index.js';

const route = useRoute();
const router = useRouter();
const orders = useOrderList();

onMounted(async () => {
  try {
    await orders.methods.refresh();
  } catch {
    showToast('订单加载失败,请稍后重试');
  }
});

function openDetail(order: OrderView): void {
  void router.push(`/orders/${order.id}`);
}
function navigate(path: string): void {
  void router.push(path);
}
</script>

<template>
  <StorePage with-tabbar class="orders">
    <StorePageHeader title="我的订单" eyebrow="ORDER NOTES" description="显示最近创建的订单,包括新订单、处理中、已完成和已取消。" />
    <StoreStatePanel v-if="orders.loading.value && !orders.data.items.value.length" state="loading" title="正在翻阅订单记录" description="稍等一下，很快就好。" />
    <StoreStatePanel v-else-if="!orders.data.items.value.length" state="empty" title="暂无订单,先去下单吧。" description="挑选喜欢的烘焙后，订单进度会显示在这里。"><template #action><button class="orders__browse" type="button" @click="navigate('/')">去首页挑选</button></template></StoreStatePanel>
    <ul v-else class="orders__list"><OrderCard v-for="order in orders.data.items.value" :key="order.id" :order="order" @open="openDetail" /></ul>
    <StoreTabbar :active-path="route.path" @navigate="navigate" />
  </StorePage>
</template>

<style scoped>
.orders__list { display: grid; gap: var(--mall-space-3); margin: 0; padding: 0; list-style: none; }
.orders__browse { min-height: 44px; padding: 0 var(--mall-space-5); border: 0; border-radius: var(--mall-radius-card); background: var(--mall-primary); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
</style>
