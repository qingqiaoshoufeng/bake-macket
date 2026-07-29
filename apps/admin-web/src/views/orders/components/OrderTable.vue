<script setup lang="ts">
import type {
  AdminOrderListItem,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';
import { ElButton, ElTable, ElTableColumn, ElTag } from 'element-plus';

import AdminEmptyState from '../../../components/feedback/AdminEmptyState.vue';
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TAG_TYPE,
} from '../../../constants/labels.js';
import { formatPriceCents } from '../../../utils/money.js';
import { orderColumns } from '../config/columns.js';

const props = defineProps<{
  orders: readonly AdminOrderListItem[];
  loading: boolean;
}>();
const emit = defineEmits<{ open: [id: string] }>();
const formatDate = (value: string): string =>
  new Date(value).toLocaleString('zh-CN');
const fulfillmentLabel = (value: FulfillmentType): string =>
  FULFILLMENT_LABELS[value];
const statusLabel = (value: OrderStatus): string => ORDER_STATUS_LABELS[value];
const statusTagType = (value: OrderStatus) => ORDER_STATUS_TAG_TYPE[value];
</script>

<template>
  <div class="order-table">
    <ElTable
      v-loading="loading"
      :data="[...props.orders]"
      row-key="id"
      height="100%"
      class="admin-table order-table__table"
    >
      <ElTableColumn
        prop="orderNo"
        :label="orderColumns[0].label"
        :min-width="orderColumns[0].minWidth"
      />
      <ElTableColumn :label="orderColumns[1].label" min-width="150">
        <template #default="{ row }">
          <strong>{{ row.contactName }}</strong>
          <small class="order-table__secondary">{{ row.contactPhone }}</small>
        </template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[2].label" width="110">
        <template #default="{ row }">{{
          fulfillmentLabel(row.fulfillmentType)
        }}</template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[3].label" width="120">
        <template #default="{ row }">
          {{ row.itemLineCount }} 种 / {{ row.totalQuantity }} 件
        </template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[4].label" width="110">
        <template #default="{ row }">{{
          formatPriceCents(row.goodsTotalCents)
        }}</template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[5].label" width="110">
        <template #default="{ row }"
          >-{{ formatPriceCents(row.membershipDiscountCents) }}</template
        >
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[6].label" width="100">
        <template #default="{ row }"
          >-{{ formatPriceCents(row.creditAppliedCents) }}</template
        >
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[7].label" width="110">
        <template #default="{ row }">{{
          formatPriceCents(row.payableTotalCents)
        }}</template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[8].label" width="100">
        <template #default="{ row }">
          <ElTag :type="statusTagType(row.status)">{{
            statusLabel(row.status)
          }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[9].label" width="170">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[10].label" width="100" fixed="right">
        <template #default="{ row }">
          <ElButton link type="primary" @click="emit('open', row.id)">
            查看详情
          </ElButton>
        </template>
      </ElTableColumn>
      <template #empty>
        <AdminEmptyState
          title="没有符合条件的订单"
          description="调整筛选条件后再试，或等待顾客提交新订单。"
          tone="mint"
        />
      </template>
    </ElTable>
  </div>
</template>

<style scoped>
.order-table,
.order-table__table {
  height: 100%;
  min-height: 0;
}

.order-table__secondary {
  display: block;
  margin-top: 4px;
  color: var(--admin-muted);
}
</style>
