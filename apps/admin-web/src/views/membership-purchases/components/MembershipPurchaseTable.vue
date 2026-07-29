<script setup lang="ts">
import type {
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipPurchaseView,
} from '@bake-mall/contracts';
import { ElButton, ElTable, ElTableColumn, ElTag } from 'element-plus';

import AdminEmptyState from '../../../components/feedback/AdminEmptyState.vue';
import {
  MEMBERSHIP_PAYMENT_STATUS_LABELS,
  MEMBERSHIP_PURCHASE_STATUS_LABELS,
} from '../../../constants/labels.js';
import { formatPriceCents } from '../../../utils/money.js';
import { membershipPurchaseColumns } from '../config/columns.js';

const props = defineProps<{
  purchases: readonly MembershipPurchaseView[];
  loading: boolean;
}>();
const emit = defineEmits<{ open: [id: string] }>();

type StatusTagType = 'warning' | 'success' | 'info';

const PURCHASE_STATUS_TAG_TYPES: Readonly<
  Record<MembershipPurchaseStatus, StatusTagType>
> = {
  PENDING: 'warning',
  FULFILLED: 'success',
  VOIDED: 'info',
};
const PAYMENT_STATUS_TAG_TYPES: Readonly<
  Record<MembershipPaymentStatus, StatusTagType>
> = {
  PENDING: 'warning',
  SUCCEEDED: 'success',
  REVERSED: 'info',
};

const formatDate = (value: string): string =>
  new Date(value).toLocaleString('zh-CN');
const purchaseStatusType = (status: MembershipPurchaseStatus): StatusTagType =>
  PURCHASE_STATUS_TAG_TYPES[status];
const purchaseStatusLabel = (status: MembershipPurchaseStatus): string =>
  MEMBERSHIP_PURCHASE_STATUS_LABELS[status];
const paymentStatusType = (status: MembershipPaymentStatus): StatusTagType =>
  PAYMENT_STATUS_TAG_TYPES[status];
const paymentStatusLabel = (status: MembershipPaymentStatus): string =>
  MEMBERSHIP_PAYMENT_STATUS_LABELS[status];
</script>

<template>
  <div class="membership-purchase-table">
    <ElTable
      v-if="loading || props.purchases.length"
      v-loading="loading"
      :data="[...props.purchases]"
      row-key="id"
      height="100%"
      class="admin-table membership-purchase-table__table"
    >
      <ElTableColumn
        prop="purchaseNo"
        :label="membershipPurchaseColumns[0].label"
        :min-width="membershipPurchaseColumns[0].minWidth"
      />
      <ElTableColumn
        prop="userId"
        :label="membershipPurchaseColumns[1].label"
        :min-width="membershipPurchaseColumns[1].minWidth"
      />
      <ElTableColumn
        :label="membershipPurchaseColumns[2].label"
        :min-width="membershipPurchaseColumns[2].minWidth"
      >
        <template #default="{ row }">
          <strong>{{ row.levelName }}</strong>
          <small class="membership-purchase-table__secondary">
            {{ row.levelCode }} · rank {{ row.levelRank }}
          </small>
        </template>
      </ElTableColumn>
      <ElTableColumn
        :label="membershipPurchaseColumns[3].label"
        :width="membershipPurchaseColumns[3].width"
      >
        <template #default="{ row }">{{
          formatPriceCents(row.priceCents)
        }}</template>
      </ElTableColumn>
      <ElTableColumn
        :label="membershipPurchaseColumns[4].label"
        :width="membershipPurchaseColumns[4].width"
      >
        <template #default="{ row }">
          <ElTag :type="paymentStatusType(row.paymentStatus)">
            {{ paymentStatusLabel(row.paymentStatus) }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn
        :label="membershipPurchaseColumns[5].label"
        :width="membershipPurchaseColumns[5].width"
      >
        <template #default="{ row }">
          <ElTag :type="purchaseStatusType(row.status)">
            {{ purchaseStatusLabel(row.status) }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn
        :label="membershipPurchaseColumns[6].label"
        :width="membershipPurchaseColumns[6].width"
      >
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn
        :label="membershipPurchaseColumns[7].label"
        :width="membershipPurchaseColumns[7].width"
        fixed="right"
      >
        <template #default="{ row }">
          <ElButton
            link
            type="primary"
            :data-testid="`open-purchase-${row.id}`"
            @click="emit('open', row.id)"
          >
            查看详情
          </ElButton>
        </template>
      </ElTableColumn>
      <template #empty>
        <AdminEmptyState
          title="没有符合条件的购卡记录"
          description="调整筛选条件后重试，或等待顾客完成新的购卡。"
          tone="mint"
        />
      </template>
    </ElTable>
    <AdminEmptyState
      v-else
      title="没有符合条件的购卡记录"
      description="调整筛选条件后重试，或等待顾客完成新的购卡。"
      tone="mint"
    />
  </div>
</template>

<style scoped>
.membership-purchase-table {
  height: 100%;
  min-height: 0;
}

.membership-purchase-table__table {
  height: 100%;
  min-height: 0;
}

.membership-purchase-table__secondary {
  display: block;
  margin-top: 4px;
  color: var(--admin-muted);
}
</style>
