<script setup lang="ts">
import type { OrderView } from '@bake-mall/contracts';
import {
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDrawer,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';

import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TAG_TYPE,
} from '../../../constants/labels.js';
import { formatPriceCents } from '../../../utils/money.js';
import type { OrderAction } from '../hooks/useOrderActions.js';

defineProps<{
  visible: boolean;
  order: OrderView | null;
  actions: readonly OrderAction[];
  loading: boolean;
  updating: boolean;
}>();
const emit = defineEmits<{
  close: [];
  action: [action: OrderAction];
}>();
const attributesText = (attributes: Record<string, string>): string =>
  Object.entries(attributes)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ');
</script>

<template>
  <ElDrawer
    :model-value="visible"
    title="订单详情"
    size="min(720px, 94vw)"
    :close-on-click-modal="!updating"
    @close="emit('close')"
  >
    <div v-loading="loading" class="order-detail">
      <template v-if="order">
        <ElDescriptions :column="2" border>
          <ElDescriptionsItem label="订单号">{{
            order.orderNo
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="状态">
            <ElTag :type="ORDER_STATUS_TAG_TYPE[order.status]">
              {{ ORDER_STATUS_LABELS[order.status] }}
            </ElTag>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="联系人">{{
            order.contactName
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="联系电话">{{
            order.contactPhone
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="履约方式">
            {{ FULFILLMENT_LABELS[order.fulfillmentType] }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="履约快照">
            {{ order.pickupTimeText ?? order.deliveryAddressText ?? '—' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="商品总额">
            {{ formatPriceCents(order.goodsTotalCents) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="买家备注">{{
            order.remark ?? '无'
          }}</ElDescriptionsItem>
        </ElDescriptions>

        <h3>商品快照</h3>
        <ElTable :data="order.items" row-key="id">
          <ElTableColumn prop="productName" label="商品" min-width="160" />
          <ElTableColumn prop="skuName" label="规格" min-width="110" />
          <ElTableColumn label="属性" min-width="150">
            <template #default="{ row }">{{
              attributesText(row.skuAttributes) || '—'
            }}</template>
          </ElTableColumn>
          <ElTableColumn label="单价" width="100">
            <template #default="{ row }">{{
              formatPriceCents(row.unitPriceCents)
            }}</template>
          </ElTableColumn>
          <ElTableColumn prop="quantity" label="数量" width="80" />
        </ElTable>

        <div v-if="actions.length" class="order-actions">
          <ElButton
            v-for="action in actions"
            :key="action.key"
            :type="action.key === 'cancel' ? 'danger' : 'primary'"
            :plain="action.key === 'cancel'"
            :loading="updating"
            @click="emit('action', action)"
          >
            {{ action.label }}
          </ElButton>
        </div>
      </template>
    </div>
  </ElDrawer>
</template>

<style scoped>
.order-detail {
  min-height: 220px;
}

.order-detail h3 {
  margin: 24px 0 12px;
  color: #3a324c;
}

.order-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
</style>
