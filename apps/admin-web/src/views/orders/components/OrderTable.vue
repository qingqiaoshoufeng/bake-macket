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
import { requirePayableTotalCents } from '../hooks/formatters.js';

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
      v-if="loading || props.orders.length"
      v-loading="loading"
      :data="[...props.orders]"
      row-key="id"
      class="admin-table order-table__table"
    >
      <ElTableColumn
        prop="orderNo"
        :label="orderColumns[0].label"
        :min-width="orderColumns[0].minWidth"
      />
      <ElTableColumn
        :label="orderColumns[1].label"
        :min-width="orderColumns[1].minWidth"
      >
        <template #default="{ row }">
          <strong>{{ row.contactName }}</strong>
          <small class="contact-phone">{{ row.contactPhone }}</small>
        </template>
      </ElTableColumn>
      <ElTableColumn
        :label="orderColumns[2].label"
        :width="orderColumns[2].width"
      >
        <template #default="{ row }">{{
          fulfillmentLabel(row.fulfillmentType)
        }}</template>
      </ElTableColumn>
      <ElTableColumn
        :label="orderColumns[3].label"
        :width="orderColumns[3].width"
      >
        <template #default="{ row }">{{
          formatPriceCents(requirePayableTotalCents(row.payableTotalCents))
        }}</template>
      </ElTableColumn>
      <ElTableColumn
        :label="orderColumns[4].label"
        :width="orderColumns[4].width"
      >
        <template #default="{ row }">
          <ElTag :type="statusTagType(row.status)">
            {{ statusLabel(row.status) }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn
        :label="orderColumns[5].label"
        :width="orderColumns[5].width"
      >
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </ElTableColumn>
      <template #empty>
        <AdminEmptyState
          title="没有符合条件的订单"
          description="调整筛选条件后再试，或等待顾客提交新订单。"
          tone="mint"
        />
      </template>

      <ElTableColumn
        :label="orderColumns[6].label"
        :width="orderColumns[6].width"
        fixed="right"
      >
        <template #default="{ row }">
          <ElButton link type="primary" @click="emit('open', row.id)"
            >查看详情</ElButton
          >
        </template>
      </ElTableColumn>
    </ElTable>
    <AdminEmptyState
      v-else
      title="没有符合条件的订单"
      description="调整筛选条件后再试，或等待顾客提交新订单。"
      tone="mint"
    />
  </div>
</template>

<style scoped>
.order-table__table {
  min-width: 1030px;
}

.contact-phone {
  display: block;
  margin-top: 4px;
  color: #938aa7;
}
</style>
