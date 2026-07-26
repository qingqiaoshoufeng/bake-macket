<script setup lang="ts">
import {
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
} from '@bake-mall/contracts';
import {
  ElButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
} from 'element-plus';

import {
  MEMBERSHIP_PAYMENT_STATUS_LABELS,
  MEMBERSHIP_PURCHASE_STATUS_LABELS,
} from '../../../constants/labels.js';
import type { MembershipPurchaseFilterForm } from '../type/index.js';

const props = defineProps<{
  filters: MembershipPurchaseFilterForm;
  loading: boolean;
}>();
const emit = defineEmits<{
  change: [value: Partial<MembershipPurchaseFilterForm>];
  search: [];
  reset: [];
}>();

const STATUS_PAYMENT_PAIRS = [
  [MembershipPurchaseStatus.PENDING, MembershipPaymentStatus.PENDING],
  [MembershipPurchaseStatus.FULFILLED, MembershipPaymentStatus.SUCCEEDED],
  [MembershipPurchaseStatus.VOIDED, MembershipPaymentStatus.REVERSED],
] as const;

function purchaseStatusOptionLabel(
  status: MembershipPurchaseStatus,
  paymentStatus: MembershipPaymentStatus,
): string {
  return `${MEMBERSHIP_PURCHASE_STATUS_LABELS[status]} / ${MEMBERSHIP_PAYMENT_STATUS_LABELS[paymentStatus]}`;
}
</script>

<template>
  <ElForm class="membership-purchase-filters" role="search">
    <ElFormItem label="购卡单号">
      <ElInput
        :model-value="props.filters.purchaseNo"
        clearable
        placeholder="输入购卡单号"
        aria-label="筛选购卡单号"
        @update:model-value="emit('change', { purchaseNo: String($event) })"
        @keyup.enter="emit('search')"
      />
    </ElFormItem>
    <ElFormItem label="用户 ID">
      <ElInput
        :model-value="props.filters.userId"
        clearable
        placeholder="输入用户 ID"
        aria-label="筛选用户"
        @update:model-value="emit('change', { userId: String($event) })"
        @keyup.enter="emit('search')"
      />
    </ElFormItem>
    <ElFormItem label="等级 ID">
      <ElInput
        :model-value="props.filters.levelId"
        clearable
        placeholder="输入等级 ID"
        aria-label="筛选会员等级"
        @update:model-value="emit('change', { levelId: String($event) })"
        @keyup.enter="emit('search')"
      />
    </ElFormItem>
    <ElFormItem label="购卡状态">
      <ElSelect
        :model-value="props.filters.status"
        clearable
        placeholder="全部购卡状态"
        aria-label="筛选购卡状态"
        @update:model-value="emit('change', { status: $event || '' })"
      >
        <ElOption
          v-for="[status, paymentStatus] in STATUS_PAYMENT_PAIRS"
          :key="status"
          :label="purchaseStatusOptionLabel(status, paymentStatus)"
          :value="status"
        />
      </ElSelect>
      <span class="membership-purchase-filters__status-help">
        待履约 / 待支付 · 已履约 / 支付成功 · 已作废 / 已冲正
      </span>
    </ElFormItem>
    <ElFormItem label="创建时间" class="membership-purchase-filters__date">
      <ElDatePicker
        :model-value="
          props.filters.createdAtRange
            ? [...props.filters.createdAtRange]
            : null
        "
        type="datetimerange"
        range-separator="至"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
        aria-label="筛选购卡创建时间"
        @update:model-value="emit('change', { createdAtRange: $event })"
      />
    </ElFormItem>
    <ElFormItem class="membership-purchase-filters__actions">
      <ElButton type="primary" :loading="loading" @click="emit('search')">
        查询
      </ElButton>
      <ElButton :disabled="loading" @click="emit('reset')">重置</ElButton>
    </ElFormItem>
  </ElForm>
</template>

<style scoped>
.membership-purchase-filters {
  display: grid;
  grid-template-columns: repeat(5, minmax(140px, 1fr));
  gap: 14px 16px;
  width: 100%;
}

.membership-purchase-filters :deep(.el-form-item) {
  display: grid;
  gap: 7px;
  margin: 0;
}

.membership-purchase-filters :deep(.el-form-item__label) {
  height: auto;
  line-height: 1.4;
}

.membership-purchase-filters :deep(.el-input),
.membership-purchase-filters :deep(.el-select),
.membership-purchase-filters :deep(.el-date-editor) {
  width: 100%;
}

.membership-purchase-filters__date {
  grid-column: span 2;
}

.membership-purchase-filters__status-help {
  display: block;
  max-width: 220px;
  margin-top: 4px;
  color: var(--admin-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.membership-purchase-filters__actions {
  align-content: end;
}

.membership-purchase-filters__actions :deep(.el-form-item__content) {
  flex-wrap: nowrap;
}

@media (max-width: 1240px) {
  .membership-purchase-filters {
    grid-template-columns: repeat(3, minmax(160px, 1fr));
  }
}

@media (max-width: 1024px) {
  .membership-purchase-filters {
    grid-template-columns: repeat(2, minmax(180px, 1fr));
  }
}
</style>
