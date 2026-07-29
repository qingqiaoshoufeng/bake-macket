<script setup lang="ts">
import type { FulfillmentType, SupplyOrderStatus } from '@bake-mall/contracts';
import {
  ElAlert,
  ElButton,
  ElPagination,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';

import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
} from '../../../constants/labels.js';
import type { SupplyDetailState } from '../hooks/useOrderSupply.js';

const props = defineProps<{
  groupKey: string;
  state?: SupplyDetailState;
}>();
const emit = defineEmits<{
  retry: [groupKey: string];
  page: [groupKey: string, page: number];
}>();

const fulfillmentSnapshot = (row: {
  pickupTimeText?: string;
  deliveryAddressText?: string;
}): string => row.pickupTimeText ?? row.deliveryAddressText ?? '—';
const statusLabel = (status: SupplyOrderStatus): string =>
  ORDER_STATUS_LABELS[status];
const fulfillmentLabel = (type: FulfillmentType): string =>
  FULFILLMENT_LABELS[type];
</script>

<template>
  <div class="order-supply-detail">
    <ElAlert
      v-if="props.state?.error"
      type="error"
      :title="props.state.error"
      :closable="false"
    >
      <template #default>
        <ElButton size="small" @click="emit('retry', props.groupKey)">
          重试
        </ElButton>
      </template>
    </ElAlert>
    <ElTable
      v-else
      v-loading="props.state?.loading"
      :data="[...(props.state?.items ?? [])]"
      size="small"
    >
      <ElTableColumn prop="orderNo" label="订单号" min-width="190" />
      <ElTableColumn label="状态" width="100">
        <template #default="{ row }">
          <ElTag>{{ statusLabel(row.status as SupplyOrderStatus) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="履约" min-width="190">
        <template #default="{ row }">
          <strong>{{
            fulfillmentLabel(row.fulfillmentType as FulfillmentType)
          }}</strong>
          <small>{{ fulfillmentSnapshot(row) }}</small>
        </template>
      </ElTableColumn>
      <ElTableColumn label="联系人" min-width="150">
        <template #default="{ row }">
          {{ row.contactName }} · {{ row.contactPhone }}
        </template>
      </ElTableColumn>
      <ElTableColumn prop="quantity" label="数量" width="80" />
      <ElTableColumn prop="remark" label="备注" min-width="150" />
      <ElTableColumn prop="orderCreatedAt" label="下单时间" width="190" />
    </ElTable>
    <ElPagination
      v-if="(props.state?.total ?? 0) > (props.state?.pageSize ?? 50)"
      small
      layout="total, prev, pager, next"
      :total="props.state?.total ?? 0"
      :current-page="props.state?.page ?? 1"
      :page-size="props.state?.pageSize ?? 50"
      @update:current-page="emit('page', props.groupKey, $event)"
    />
  </div>
</template>

<style scoped>
.order-supply-detail {
  display: grid;
  gap: 10px;
  padding: 12px 18px;
  background: var(--admin-surface-soft);
}

.order-supply-detail small {
  display: block;
  margin-top: 3px;
  color: var(--admin-muted);
}
</style>
