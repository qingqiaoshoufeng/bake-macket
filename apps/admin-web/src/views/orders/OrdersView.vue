<script setup lang="ts">
import { onMounted } from 'vue';
import { ElAlert, ElMessage, ElMessageBox, ElPagination } from 'element-plus';

import OrderDetailDrawer from './components/OrderDetailDrawer.vue';
import OrderFilters from './components/OrderFilters.vue';
import OrderTable from './components/OrderTable.vue';
import { ORDER_PAGINATION } from './config/pagination.js';
import type { OrderAction } from './hooks/useOrderActions.js';
import { useOrders } from './hooks/useOrders.js';
import type { OrderFilterForm } from './type/index.js';

const state = useOrders();
onMounted(state.load);

function updateFilters(value: Partial<OrderFilterForm>): void {
  Object.assign(state.filters, value);
}

async function runAction(action: OrderAction): Promise<void> {
  if (action.key === 'cancel') {
    try {
      await ElMessageBox.confirm(
        '取消订单不会回补库存。确定继续取消该订单吗？',
        '取消订单',
        {
          type: 'warning',
          confirmButtonText: '确认取消',
          cancelButtonText: '返回',
        },
      );
    } catch (error) {
      if (error === 'cancel' || error === 'close') return;
      ElMessage.error('取消确认失败，请重试');
      return;
    }
  }

  try {
    const result = await state.updateStatus(action.status);
    ElMessage.success(
      result.noRestock ? '订单已取消，库存未回补' : `${action.label}成功`,
    );
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : '订单状态更新失败',
    );
  }
}
</script>

<template>
  <section class="orders-page">
    <header class="orders-page__head">
      <div>
        <span>履约工作台</span>
        <h1>订单管理</h1>
        <p>筛选订单、查看不可变快照，并执行合法状态流转。</p>
      </div>
    </header>

    <OrderFilters
      :filters="state.filters"
      :loading="state.loading.value"
      @change="updateFilters"
      @search="state.search"
      @reset="state.reset"
    />

    <ElAlert
      v-if="state.lastError.value"
      type="error"
      :title="state.lastError.value"
      :closable="false"
      show-icon
    />

    <OrderTable
      :orders="state.orders.value"
      :loading="state.loading.value"
      @open="state.openDetail"
    />

    <ElPagination
      v-if="state.total.value > 0"
      class="orders-page__pagination"
      background
      layout="total, sizes, prev, pager, next"
      :total="state.total.value"
      :current-page="state.page.value"
      :page-size="state.pageSize.value"
      :page-sizes="[...ORDER_PAGINATION.pageSizes]"
      @update:current-page="state.setPage"
      @update:page-size="state.setPageSize"
    />

    <OrderDetailDrawer
      :visible="state.detailVisible.value"
      :order="state.detail.value"
      :actions="state.actions.value"
      :loading="state.detailLoading.value"
      :updating="state.updating.value"
      @close="state.closeDetail"
      @action="runAction"
    />
  </section>
</template>

<style scoped>
.orders-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.orders-page__head {
  padding: 20px 24px;
  border: 1px solid #e9e0f8;
  border-radius: 18px;
  background: linear-gradient(120deg, #fff 0%, #f7f1ff 72%, #ffeef3 100%);
}

.orders-page__head span {
  color: #9675bf;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.orders-page__head h1 {
  margin: 5px 0 0;
  color: #342c47;
  font-size: 24px;
}

.orders-page__head p {
  margin: 7px 0 0;
  color: #817692;
  font-size: 13px;
}

.orders-page__pagination {
  justify-content: flex-end;
}
</style>
