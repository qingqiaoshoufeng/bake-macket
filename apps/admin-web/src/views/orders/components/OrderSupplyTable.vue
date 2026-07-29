<script setup lang="ts">
import {
  AdminOrderSupplyMatchType,
  type AdminOrderSupplyItem,
} from '@bake-mall/contracts';
import { ElTable, ElTableColumn, ElTag } from 'element-plus';

import AdminEmptyState from '../../../components/feedback/AdminEmptyState.vue';
import OrderSupplyDetail from './OrderSupplyDetail.vue';
import type { SupplyDetailState } from '../hooks/useOrderSupply.js';

const props = defineProps<{
  items: readonly AdminOrderSupplyItem[];
  details: ReadonlyMap<string, SupplyDetailState>;
  loading: boolean;
}>();
const emit = defineEmits<{
  expand: [groupKey: string];
  retry: [groupKey: string];
  'detail-page': [groupKey: string, page: number];
}>();

const formatAttributes = (
  attributes: Readonly<Record<string, string>>,
): string =>
  Object.entries(attributes)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' / ') || '默认规格';

function onExpand(
  row: AdminOrderSupplyItem,
  expanded: boolean | AdminOrderSupplyItem[],
): void {
  const isExpanded = Array.isArray(expanded)
    ? expanded.some(({ groupKey }) => groupKey === row.groupKey)
    : expanded;
  if (isExpanded) emit('expand', row.groupKey);
}
</script>

<template>
  <div class="order-supply-table">
    <ElTable
      v-loading="props.loading"
      :data="[...props.items]"
      row-key="groupKey"
      height="100%"
      class="admin-table order-supply-table__table"
      @expand-change="onExpand"
    >
      <ElTableColumn type="expand" width="52">
        <template #default="{ row }">
          <OrderSupplyDetail
            :group-key="row.groupKey"
            :state="props.details.get(row.groupKey)"
            @retry="emit('retry', $event)"
            @page="(groupKey, page) => emit('detail-page', groupKey, page)"
          />
        </template>
      </ElTableColumn>
      <ElTableColumn label="商品 / SKU" min-width="210">
        <template #default="{ row }">
          <strong>{{ row.productName }}</strong>
          <small>{{ row.skuName }}</small>
        </template>
      </ElTableColumn>
      <ElTableColumn label="规格" min-width="180">
        <template #default="{ row }">
          {{ formatAttributes(row.skuAttributes) }}
        </template>
      </ElTableColumn>
      <ElTableColumn prop="requiredQuantity" label="需供货数量" width="120" />
      <ElTableColumn prop="orderCount" label="订单数" width="90" />
      <ElTableColumn prop="newQuantity" label="待处理" width="90" />
      <ElTableColumn prop="processingQuantity" label="处理中" width="90" />
      <ElTableColumn label="剩余可售库存（参考）" width="170">
        <template #default="{ row }">
          {{ row.remainingSaleableStock ?? '不可用' }}
        </template>
      </ElTableColumn>
      <ElTableColumn
        prop="earliestOrderCreatedAt"
        label="最早下单"
        width="190"
      />
      <ElTableColumn label="数据状态" width="120">
        <template #default="{ row }">
          <ElTag
            :type="
              row.matchType === AdminOrderSupplyMatchType.SKU_ID
                ? 'success'
                : 'warning'
            "
          >
            {{
              row.matchType === AdminOrderSupplyMatchType.SKU_ID
                ? 'SKU 匹配'
                : '历史匹配'
            }}
          </ElTag>
        </template>
      </ElTableColumn>
      <template #empty>
        <AdminEmptyState
          title="当前没有待供货商品"
          description="调整筛选条件，或等待新的待处理订单。"
          tone="mint"
        />
      </template>
    </ElTable>
  </div>
</template>

<style scoped>
.order-supply-table,
.order-supply-table__table {
  height: 100%;
  min-height: 0;
}

.order-supply-table small {
  display: block;
  margin-top: 4px;
  color: var(--admin-muted);
}
</style>
