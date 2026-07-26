<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';

import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import StorePage from '../components/layout/StorePage.vue';
import StorePageHeader from '../components/layout/StorePageHeader.vue';
import { OrderSnapshot, useOrderDetail } from './orders/index.js';

const route = useRoute();
const router = useRouter();
const detail = useOrderDetail();

async function load(id: string): Promise<void> {
  try {
    await detail.methods.load(id);
  } catch {
    showToast('订单加载失败');
  }
}

function loadRouteOrder(id: unknown): void {
  if (typeof id === 'string' && id) {
    void load(id);
    return;
  }
  detail.methods.clear();
}

onMounted(() => loadRouteOrder(route.params.id));
watch(() => route.params.id, loadRouteOrder);
</script>

<template>
  <StorePage compact class="order-detail">
    <StorePageHeader
      back
      title="订单详情"
      eyebrow="ORDER SNAPSHOT"
      @back="router.push('/orders')"
    />
    <StoreStatePanel
      v-if="detail.error.value"
      state="error"
      title="订单加载失败"
      :description="detail.error.value"
    >
      <template #action
        ><button
          class="order-detail__retry"
          type="button"
          @click="loadRouteOrder(route.params.id)"
        >
          重新加载
        </button></template
      >
    </StoreStatePanel>
    <StoreStatePanel
      v-else-if="detail.loading.value || !detail.data.order.value"
      state="loading"
      title="正在加载订单"
      description="正在核对这笔订单的不可变快照。"
    />
    <OrderSnapshot v-else :order="detail.data.order.value" />
  </StorePage>
</template>

<style scoped>
.order-detail {
  display: grid;
  gap: var(--mall-space-3);
}
.order-detail :deep(.store-page-header) {
  margin-bottom: var(--mall-space-3);
}
.order-detail__retry {
  min-height: 44px;
  padding: 0 var(--mall-space-5);
  border: 0;
  border-radius: var(--mall-radius-control);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
</style>
