<script setup lang="ts">
import { onMounted } from 'vue';
import { ElAlert, ElMessage, ElMessageBox, ElPagination } from 'element-plus';

import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
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
  <AdminPage>
    <AdminPageHeader
      eyebrow="FULFILLMENT"
      title="订单管理"
      description="筛选订单、查看不可变快照，并执行合法状态流转。"
    />

    <ElAlert
      v-if="state.lastError.value"
      type="error"
      :title="state.lastError.value"
      :closable="false"
      show-icon
    />

    <AdminDataPanel>
      <template #toolbar>
        <OrderFilters
          :filters="state.filters"
          :loading="state.loading.value"
          @change="updateFilters"
          @search="state.search"
          @reset="state.reset"
        />
      </template>

      <OrderTable
        :orders="state.orders.value"
        :loading="state.loading.value"
        @open="state.openDetail"
      />

      <template v-if="state.total.value > 0" #footer>
        <ElPagination
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
      </template>
    </AdminDataPanel>

    <OrderDetailDrawer
      :visible="state.detailVisible.value"
      :order="state.detail.value"
      :actions="state.actions.value"
      :loading="state.detailLoading.value"
      :updating="state.updating.value"
      @close="state.closeDetail"
      @action="runAction"
    />
  </AdminPage>
</template>

<style scoped>
.orders-page__pagination {
  justify-content: flex-end;
}
</style>
