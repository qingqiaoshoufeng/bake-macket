<script setup lang="ts">
import type {
  AdminOrderListItem,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';
import { ElButton, ElEmpty, ElTable, ElTableColumn, ElTag } from 'element-plus';

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
      v-if="loading || props.orders.length"
      v-loading="loading"
      :data="[...props.orders]"
      row-key="id"
    >
      <ElTableColumn
        prop="orderNo"
        :label="orderColumns[0].label"
        min-width="190"
      />
      <ElTableColumn :label="orderColumns[1].label" min-width="150">
        <template #default="{ row }">
          <strong>{{ row.contactName }}</strong>
          <small class="contact-phone">{{ row.contactPhone }}</small>
        </template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[2].label" width="110">
        <template #default="{ row }">{{
          fulfillmentLabel(row.fulfillmentType)
        }}</template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[3].label" width="110">
        <template #default="{ row }">{{
          formatPriceCents(row.goodsTotalCents)
        }}</template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[4].label" width="100">
        <template #default="{ row }">
          <ElTag :type="statusTagType(row.status)">
            {{ statusLabel(row.status) }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[5].label" width="170">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn :label="orderColumns[6].label" width="100" fixed="right">
        <template #default="{ row }">
          <ElButton link type="primary" @click="emit('open', row.id)"
            >查看详情</ElButton
          >
        </template>
      </ElTableColumn>
    </ElTable>
    <ElEmpty v-else description="没有符合条件的订单" />
  </div>
</template>

<style scoped>
.order-table {
  overflow: hidden;
  border: 1px solid #ece6f8;
  border-radius: 16px;
  background: #fff;
}

.contact-phone {
  display: block;
  margin-top: 4px;
  color: #938aa7;
}
</style>
