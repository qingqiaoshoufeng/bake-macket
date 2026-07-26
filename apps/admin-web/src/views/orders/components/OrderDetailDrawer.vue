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
        <section class="order-detail__group" data-snapshot-group="order">
          <div class="order-detail__group-heading">
            <span>ORDER SNAPSHOT</span>
            <h3>订单与履约快照</h3>
          </div>
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
            <ElDescriptionsItem label="商品原价">
              {{ formatPriceCents(order.goodsTotalCents) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="会员优惠">
              -{{ formatPriceCents(order.membershipDiscountCents) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="消费金抵扣">
              -{{ formatPriceCents(order.creditAppliedCents) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="应付金额">
              {{ formatPriceCents(order.payableTotalCents) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="会员快照">
              {{
                order.membershipId
                  ? `${order.membershipName} · ${order.membershipDiscountBasisPoints / 1000} 折（${order.membershipCode}）`
                  : '未使用会员'
              }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="买家备注">{{
              order.remark ?? '无'
            }}</ElDescriptionsItem>
          </ElDescriptions>
        </section>

        <section class="order-detail__group" data-snapshot-group="items">
          <div class="order-detail__group-heading">
            <span>ITEM SNAPSHOT</span>
            <h3>商品快照</h3>
          </div>
          <div class="admin-horizontal-scroll" data-testid="order-items-scroll">
            <ElTable
              :data="order.items"
              row-key="id"
              class="admin-table order-detail__items-table"
            >
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
              <ElTableColumn label="行原价" width="110">
                <template #default="{ row }">{{
                  formatPriceCents(row.lineGoodsTotalCents)
                }}</template>
              </ElTableColumn>
              <ElTableColumn label="行优惠" width="110">
                <template #default="{ row }">{{
                  formatPriceCents(row.lineMembershipDiscountCents)
                }}</template>
              </ElTableColumn>
              <ElTableColumn label="折后金额" width="110">
                <template #default="{ row }">{{
                  formatPriceCents(row.linePayableCents)
                }}</template>
              </ElTableColumn>
            </ElTable>
          </div>
        </section>

        <div v-if="actions.length" class="order-actions order-actions--sticky">
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
  display: grid;
  gap: 20px;
  min-height: 220px;
}

.order-detail__group {
  padding: 18px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
}

.order-detail__group-heading {
  margin-bottom: 14px;
}

.order-detail__group-heading span {
  color: var(--admin-primary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.order-detail__group-heading h3 {
  margin: 4px 0 0;
  color: var(--admin-text);
  font-size: 16px;
}

.order-detail__items-table {
  min-width: 640px;
}

.order-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.order-actions--sticky {
  position: sticky;
  z-index: 2;
  bottom: -20px;
  margin: 0 -24px -20px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--admin-border);
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 -8px 20px rgb(73 57 105 / 6%);
  backdrop-filter: blur(8px);
}
</style>
