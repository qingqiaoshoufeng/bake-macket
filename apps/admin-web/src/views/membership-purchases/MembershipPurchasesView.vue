<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElMessage,
  ElMessageBox,
  ElPagination,
} from 'element-plus';
import { onMounted } from 'vue';

import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import MembershipPurchaseDetailDrawer from './components/MembershipPurchaseDetailDrawer.vue';
import MembershipPurchaseFilters from './components/MembershipPurchaseFilters.vue';
import MembershipPurchaseTable from './components/MembershipPurchaseTable.vue';
import { MEMBERSHIP_PURCHASE_PAGINATION } from './config/pagination.js';
import { useMembershipLevelOptions } from './hooks/useMembershipLevelOptions.js';
import { useMembershipPurchases } from './hooks/useMembershipPurchases.js';
import type { MembershipPurchaseFilterForm } from './type/index.js';

const state = useMembershipPurchases();
const levels = useMembershipLevelOptions();
onMounted(() => Promise.all([state.load(), levels.load()]));

function updateFilters(value: Partial<MembershipPurchaseFilterForm>): void {
  state.setFilters(value);
}

async function voidPurchase(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '作废后会冲销本次剩余赠送消费金，并按购买类型回退或恢复会员有效期。该操作会由后端在事务内重新校验最终资格，确定继续吗？',
      '作废购卡记录',
      {
        type: 'warning',
        confirmButtonText: '确认作废',
        cancelButtonText: '返回详情',
      },
    );
  } catch (confirmationError) {
    if (confirmationError === 'cancel' || confirmationError === 'close') return;
    ElMessage.error('作废确认失败，请重试');
    return;
  }

  try {
    const result = await state.voidSelected();
    if (result.status === 'applied') {
      ElMessage.success('购卡记录已作废');
    }
  } catch (actionError) {
    ElMessage.error(
      actionError instanceof Error ? actionError.message : '购卡记录作废失败',
    );
  }
}
</script>

<template>
  <AdminPage class="membership-purchases-view">
    <AdminPageHeader
      eyebrow="MEMBERSHIP LEDGER"
      title="购卡记录"
      description="筛选独立购卡单，核对会员链、有效期贡献和消费金流水，并安全执行作废。"
    />

    <ElAlert
      v-if="state.listError.value"
      type="error"
      title="购卡记录加载失败"
      :description="state.listError.value"
      :closable="false"
      show-icon
    >
      <template #default>
        <p class="membership-purchases-view__error-copy">
          {{ state.listError.value }}
        </p>
        <ElButton
          size="small"
          data-testid="retry-purchase-list"
          @click="state.load"
        >
          重新加载
        </ElButton>
      </template>
    </ElAlert>

    <AdminDataPanel>
      <template #toolbar>
        <MembershipPurchaseFilters
          :filters="state.filters"
          :loading="state.loading.value"
          :level-options="levels.options.value"
          @change="updateFilters"
          @search="state.search"
          @reset="state.reset"
        />
      </template>

      <MembershipPurchaseTable
        :purchases="state.purchases.value"
        :loading="state.loading.value"
        @open="state.openDetail"
      />

      <template v-if="state.total.value > 0" #footer>
        <ElPagination
          class="membership-purchases-view__pagination"
          background
          layout="total, sizes, prev, pager, next"
          :total="state.total.value"
          :current-page="state.page.value"
          :page-size="state.pageSize.value"
          :page-sizes="[...MEMBERSHIP_PURCHASE_PAGINATION.pageSizes]"
          @update:current-page="state.setPage"
          @update:page-size="state.setPageSize"
        />
      </template>
    </AdminDataPanel>

    <MembershipPurchaseDetailDrawer
      :visible="state.detailVisible.value"
      :detail="state.detail.value"
      :loading="state.detailLoading.value"
      :voiding="state.voiding.value"
      :detail-error="state.detailError.value"
      :action-error="state.actionError.value"
      :membership-id="state.selectedMembershipId.value"
      @close="state.closeDetail"
      @retry="state.retryDetail"
      @void="voidPurchase"
    />
  </AdminPage>
</template>

<style scoped>
.membership-purchases-view {
  gap: 22px;
}

.membership-purchases-view__error-copy {
  margin: 0 0 10px;
}

.membership-purchases-view__pagination {
  justify-content: flex-end;
}
</style>
