<script setup lang="ts">
import { AdminOrderExportView, AdminRole } from '@bake-mall/contracts';
import { computed, onMounted } from 'vue';
import { ElAlert, ElMessage, ElMessageBox, ElPagination } from 'element-plus';

import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import { PAGE_SIZE_OPTIONS } from '../../config/pagination.js';
import { useAdminAuthStore } from '../../stores/admin-auth.js';
import OrderDetailDrawer from './components/OrderDetailDrawer.vue';
import OrderFilters from './components/OrderFilters.vue';
import OrderModeSwitch from './components/OrderModeSwitch.vue';
import OrderSupplyTable from './components/OrderSupplyTable.vue';
import OrderTable from './components/OrderTable.vue';
import type { OrderAction } from './hooks/useOrderActions.js';
import { useOrderWorkspace } from './hooks/useOrderWorkspace.js';

const state = useOrderWorkspace();
const adminAuth = useAdminAuthStore();
const isSuperAdmin = computed(() => adminAuth.role === AdminRole.SUPER_ADMIN);
onMounted(state.initialize);

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
    const result = await state.orderList.updateStatus(action.status);
    ElMessage.success(
      result.noRestock ? '订单已取消，库存未回补' : `${action.label}成功`,
    );
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : '订单状态更新失败',
    );
  }
}

async function exportCurrent(): Promise<void> {
  try {
    await state.exportCurrent();
    ElMessage.success('Excel 已开始下载');
  } catch {
    ElMessage.error(
      state.exportState.exportError.value ?? '订单导出失败，请重试',
    );
  }
}
</script>

<template>
  <AdminPage workspace>
    <template #header>
      <AdminPageHeader
        eyebrow="FULFILLMENT"
        title="订单管理"
        :description="
          isSuperAdmin
            ? '逐单处理订单，或按 SKU 汇总待供货数量并导出 Excel。'
            : '查看全部订单并处理合法的订单状态流转。'
        "
      >
        <template #actions>
          <OrderModeSwitch
            v-if="isSuperAdmin"
            :model-value="state.mode.value"
            :exporting="state.exportState.exporting.value"
            @update:model-value="state.switchMode"
            @export="exportCurrent"
          />
        </template>
      </AdminPageHeader>
    </template>

    <template v-if="state.activeError.value" #alert>
      <ElAlert
        type="error"
        :title="state.activeError.value"
        :closable="false"
        show-icon
      />
    </template>

    <AdminDataPanel fill>
      <template #toolbar>
        <OrderFilters
          :filters="state.filters"
          :loading="state.activeLoading.value"
          :advanced-count="state.advancedCount.value"
          :supply-mode="state.mode.value === AdminOrderExportView.SUPPLY"
          :supply-statuses="state.supplyList.supplyStatuses.value"
          @change="state.orderList.setFilters"
          @supply-statuses-change="state.setSupplyStatuses"
          @search="state.search"
          @reset="state.reset"
        />
      </template>

      <OrderTable
        v-if="state.mode.value === AdminOrderExportView.ORDER"
        :orders="state.orderList.orders.value"
        :loading="state.orderList.loading.value"
        @open="state.orderList.openDetail"
      />
      <OrderSupplyTable
        v-else
        :items="state.supplyList.items.value"
        :details="state.supplyList.details.value"
        :loading="state.supplyList.loading.value"
        @expand="
          (groupKey) =>
            state.supplyList.loadDetail(groupKey, state.appliedFilters.value)
        "
        @retry="
          (groupKey) =>
            state.supplyList.retryDetail(groupKey, state.appliedFilters.value)
        "
        @detail-page="
          (groupKey, page) =>
            state.supplyList.loadDetail(
              groupKey,
              state.appliedFilters.value,
              page,
            )
        "
      />

      <template v-if="state.activeTotal.value > 0" #footer>
        <ElPagination
          class="orders-page__pagination"
          background
          layout="total, sizes, prev, pager, next"
          :total="state.activeTotal.value"
          :current-page="state.activePage.value"
          :page-size="state.activePageSize.value"
          :page-sizes="[...PAGE_SIZE_OPTIONS]"
          @update:current-page="state.setPage"
          @update:page-size="state.setPageSize"
        />
      </template>
    </AdminDataPanel>

    <OrderDetailDrawer
      :visible="state.orderList.detailVisible.value"
      :order="state.orderList.detail.value"
      :actions="state.orderList.actions.value"
      :loading="state.orderList.detailLoading.value"
      :updating="state.orderList.updating.value"
      @close="state.orderList.closeDetail"
      @action="runAction"
    />
  </AdminPage>
</template>

<style scoped>
.orders-page__pagination {
  justify-content: flex-end;
}
</style>
