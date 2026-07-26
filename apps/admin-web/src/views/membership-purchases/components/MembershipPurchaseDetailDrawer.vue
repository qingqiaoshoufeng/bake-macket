<script setup lang="ts">
import type {
  AdminMemberCreditEntryView,
  AdminMembershipPurchaseDetailView,
  AdminMembershipRecordView,
} from '@bake-mall/contracts';
import {
  ElAlert,
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDrawer,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';

import {
  MEMBER_CREDIT_DIRECTION_LABELS,
  MEMBER_CREDIT_ENTRY_TYPE_LABELS,
  MEMBER_CREDIT_GRANT_STATUS_LABELS,
  MEMBERSHIP_PAYMENT_CHANNEL_LABELS,
  MEMBERSHIP_PAYMENT_STATUS_LABELS,
  MEMBERSHIP_PURCHASE_STATUS_LABELS,
  MEMBERSHIP_SEGMENT_KIND_LABELS,
  MEMBERSHIP_STATUS_LABELS,
} from '../../../constants/labels.js';
import {
  basisPointsToDiscountText,
  formatPriceCents,
} from '../../../utils/money.js';

const props = defineProps<{
  visible: boolean;
  detail: AdminMembershipPurchaseDetailView | null;
  loading: boolean;
  voiding: boolean;
  detailError: string | null;
  actionError: string | null;
  membershipId: string | null;
}>();
const emit = defineEmits<{
  close: [];
  retry: [];
  void: [];
}>();

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN') : '—';
const discountText = (value: number): string =>
  `${basisPointsToDiscountText(value)} 折`;
const membershipStatusLabel = (
  status: AdminMembershipRecordView['status'],
): string => MEMBERSHIP_STATUS_LABELS[status];
const benefitText = (
  benefit: AdminMembershipRecordView['benefits'][number],
): string =>
  [
    `#${benefit.sortOrder}`,
    benefit.title,
    benefit.description,
    benefit.iconKey ? `icon:${benefit.iconKey}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
const membershipBenefitsText = (
  benefits: AdminMembershipRecordView['benefits'],
): string => benefits.map(benefitText).join('、') || '—';
const membershipThemeText = (
  cardTheme: AdminMembershipRecordView['cardTheme'],
): string => `${cardTheme.theme} · ${cardTheme.badgeText}`;
const creditEntryLabel = (
  direction: AdminMemberCreditEntryView['direction'],
  type: AdminMemberCreditEntryView['type'],
): string =>
  `${MEMBER_CREDIT_DIRECTION_LABELS[direction]} · ${MEMBER_CREDIT_ENTRY_TYPE_LABELS[type]}`;
const voidReason = (): string => {
  const value = props.detail?.voidability;
  return value && !value.allowed
    ? value.reason
    : '权益完全未使用且位于会员链末端';
};
</script>

<template>
  <ElDrawer
    :model-value="visible"
    title="购卡记录详情"
    size="min(860px, 96vw)"
    :close-on-click-modal="!voiding"
    :close-on-press-escape="!voiding"
    @close="emit('close')"
  >
    <div v-loading="loading" class="membership-purchase-detail">
      <ElAlert
        v-if="detailError"
        type="error"
        title="购卡详情加载失败"
        :description="detailError"
        :closable="false"
        show-icon
      >
        <template #default>
          <ElButton
            size="small"
            data-testid="retry-purchase-detail"
            @click="emit('retry')"
          >
            重新加载详情
          </ElButton>
        </template>
      </ElAlert>

      <template v-if="detail">
        <section class="membership-purchase-detail__group">
          <div class="membership-purchase-detail__heading">
            <span>PURCHASE SNAPSHOT</span>
            <h3>购买与支付快照</h3>
          </div>
          <ElDescriptions :column="2" border>
            <ElDescriptionsItem label="购买记录 ID">{{
              detail.purchase.id
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="购卡单号">{{
              detail.purchase.purchaseNo
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="用户 ID">{{
              detail.purchase.userId
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="等级">
              {{ detail.purchase.levelName }}（{{ detail.purchase.levelCode }}）
            </ElDescriptionsItem>
            <ElDescriptionsItem label="等级 ID">{{
              detail.purchase.levelId
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="等级 rank">{{
              detail.purchase.levelRank
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="履约状态">
              <ElTag>{{
                MEMBERSHIP_PURCHASE_STATUS_LABELS[detail.purchase.status]
              }}</ElTag>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="支付状态">
              <ElTag>{{
                MEMBERSHIP_PAYMENT_STATUS_LABELS[detail.purchase.paymentStatus]
              }}</ElTag>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="支付渠道">
              {{
                MEMBERSHIP_PAYMENT_CHANNEL_LABELS[
                  detail.purchase.paymentChannel
                ]
              }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="支付金额">{{
              formatPriceCents(detail.purchase.priceCents)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="赠送消费金">{{
              formatPriceCents(detail.purchase.grantCreditCents)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="折扣 / 有效期">
              {{ discountText(detail.purchase.discountBasisPoints) }} /
              {{ detail.purchase.validDays }} 天
            </ElDescriptionsItem>
            <ElDescriptionsItem label="会员 ID">{{
              membershipId ?? '待履约'
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="支付时间">{{
              formatDate(detail.purchase.paidAt)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="作废时间">{{
              formatDate(detail.purchase.voidedAt)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="创建时间">{{
              formatDate(detail.purchase.createdAt)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="更新时间">{{
              formatDate(detail.purchase.updatedAt)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="卡面"
              >{{ detail.purchase.cardTheme.theme }} ·
              {{ detail.purchase.cardTheme.badgeText }}</ElDescriptionsItem
            >
          </ElDescriptions>
          <div class="membership-purchase-detail__benefits">
            <strong>权益快照</strong>
            <ul>
              <li
                v-for="benefit in detail.purchase.benefits"
                :key="`${benefit.sortOrder}-${benefit.title}`"
              >
                {{ benefitText(benefit) }}
              </li>
            </ul>
          </div>
        </section>

        <section class="membership-purchase-detail__group">
          <div class="membership-purchase-detail__heading">
            <span>MEMBERSHIP CHAIN</span>
            <h3>会员链</h3>
          </div>
          <ElTable
            :data="detail.membershipChain"
            row-key="id"
            class="admin-table"
          >
            <ElTableColumn prop="id" label="会员 ID" min-width="150" />
            <ElTableColumn prop="userId" label="用户 ID" min-width="140" />
            <ElTableColumn
              prop="purchaseOrderId"
              label="来源购卡 ID"
              min-width="160"
            />
            <ElTableColumn prop="levelName" label="等级" min-width="120" />
            <ElTableColumn prop="levelCode" label="等级 code" min-width="130" />
            <ElTableColumn prop="levelRank" label="rank" width="80" />
            <ElTableColumn label="折扣" width="100">
              <template #default="{ row }">{{
                discountText(row.discountBasisPoints)
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="权益快照" min-width="180">
              <template #default="{ row }">{{
                membershipBenefitsText(row.benefits)
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="卡面快照" min-width="170">
              <template #default="{ row }">{{
                membershipThemeText(row.cardTheme)
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="状态" width="100">
              <template #default="{ row }">{{
                membershipStatusLabel(row.status)
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="开始" min-width="170">
              <template #default="{ row }">{{
                formatDate(row.startsAt)
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="结束" min-width="170">
              <template #default="{ row }">{{
                formatDate(row.endsAt)
              }}</template>
            </ElTableColumn>
            <ElTableColumn
              prop="previousMembershipId"
              label="前一会员"
              min-width="150"
            />
            <ElTableColumn label="创建时间" min-width="170">
              <template #default="{ row }">{{
                formatDate(row.createdAt)
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="更新时间" min-width="170">
              <template #default="{ row }">{{
                formatDate(row.updatedAt)
              }}</template>
            </ElTableColumn>
          </ElTable>
        </section>

        <section class="membership-purchase-detail__group">
          <div class="membership-purchase-detail__heading">
            <span>ENTITLEMENT SEGMENT</span>
            <h3>有效期贡献</h3>
          </div>
          <ElDescriptions v-if="detail.segment" :column="2" border>
            <ElDescriptionsItem label="segment ID">{{
              detail.segment.id
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="来源购卡 ID">{{
              detail.segment.purchaseOrderId
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="类型">{{
              MEMBERSHIP_SEGMENT_KIND_LABELS[detail.segment.kind]
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="会员 ID">{{
              detail.segment.membershipId
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="贡献开始">{{
              formatDate(detail.segment.startsAt)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="贡献结束">{{
              formatDate(detail.segment.endsAt)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="前一会员">{{
              detail.segment.previousMembershipId ?? '—'
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="前一到期时间">{{
              formatDate(detail.segment.previousMembershipEndsAt)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="记录时间">{{
              formatDate(detail.segment.createdAt)
            }}</ElDescriptionsItem>
          </ElDescriptions>
          <p v-else class="membership-purchase-detail__muted">
            待支付购卡单尚未产生有效期贡献。
          </p>
        </section>

        <section class="membership-purchase-detail__group">
          <div class="membership-purchase-detail__heading">
            <span>CREDIT GRANT</span>
            <h3>消费金 grant</h3>
          </div>
          <ElDescriptions v-if="detail.grant" :column="2" border>
            <ElDescriptionsItem label="发放金额">{{
              formatPriceCents(detail.grant.grantedCents)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="剩余金额">{{
              formatPriceCents(detail.grant.remainingCents)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="状态">{{
              MEMBER_CREDIT_GRANT_STATUS_LABELS[detail.grant.status]
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="grant ID">{{
              detail.grant.id
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="账户 ID">{{
              detail.grant.accountId
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="来源购卡 ID">{{
              detail.grant.purchaseOrderId
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="创建时间">{{
              formatDate(detail.grant.createdAt)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="更新时间">{{
              formatDate(detail.grant.updatedAt)
            }}</ElDescriptionsItem>
          </ElDescriptions>
          <p v-else class="membership-purchase-detail__muted">
            本次购卡没有消费金 grant。
          </p>
        </section>

        <section class="membership-purchase-detail__group">
          <div class="membership-purchase-detail__heading">
            <span>IMMUTABLE LEDGER</span>
            <h3>发放与冲正流水</h3>
          </div>
          <ElTable :data="detail.entries" row-key="id" class="admin-table">
            <ElTableColumn prop="id" label="流水 ID" min-width="150" />
            <ElTableColumn prop="accountId" label="账户 ID" min-width="150" />
            <ElTableColumn label="方向 / 类型" min-width="190">
              <template #default="{ row }">{{
                creditEntryLabel(row.direction, row.type)
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="金额" width="110">
              <template #default="{ row }">{{
                formatPriceCents(row.amountCents)
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="变更后余额" width="130">
              <template #default="{ row }">{{
                formatPriceCents(row.balanceAfterCents)
              }}</template>
            </ElTableColumn>
            <ElTableColumn
              prop="referenceType"
              label="引用类型"
              min-width="160"
            />
            <ElTableColumn prop="referenceId" label="引用 ID" min-width="160" />
            <ElTableColumn prop="operationKey" label="操作键" min-width="230" />
            <ElTableColumn
              prop="reversalOfEntryId"
              label="冲正原流水"
              min-width="150"
            />
            <ElTableColumn label="记录时间" min-width="170">
              <template #default="{ row }">{{
                formatDate(row.createdAt)
              }}</template>
            </ElTableColumn>
          </ElTable>
          <p
            v-if="!detail.entries.length"
            class="membership-purchase-detail__muted"
          >
            暂无关联流水。
          </p>
        </section>

        <section
          class="membership-purchase-detail__group membership-purchase-detail__voidability"
          aria-live="polite"
        >
          <div class="membership-purchase-detail__heading">
            <span>VOIDABILITY</span>
            <h3>作废资格</h3>
          </div>
          <ElAlert
            :type="detail.voidability.allowed ? 'success' : 'warning'"
            :title="detail.voidability.allowed ? '可作废' : '当前不可作废'"
            :description="voidReason()"
            :closable="false"
            show-icon
          />
          <ElAlert
            v-if="actionError"
            class="membership-purchase-detail__action-error"
            type="error"
            title="作废失败"
            :description="actionError"
            :closable="false"
            show-icon
          />
        </section>

        <div class="membership-purchase-detail__actions">
          <ElButton
            type="danger"
            plain
            data-testid="void-membership-purchase"
            :disabled="!detail.voidability.allowed"
            :loading="voiding"
            @click="emit('void')"
          >
            作废购卡记录
          </ElButton>
        </div>
      </template>
    </div>
  </ElDrawer>
</template>

<style scoped>
.membership-purchase-detail {
  display: grid;
  gap: 18px;
  min-height: 240px;
}

.membership-purchase-detail__group {
  padding: 18px;
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
}

.membership-purchase-detail__heading {
  margin-bottom: 14px;
}

.membership-purchase-detail__heading span {
  color: var(--admin-primary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.membership-purchase-detail__heading h3 {
  margin: 4px 0 0;
  color: var(--admin-text);
  font-size: 16px;
}

.membership-purchase-detail__benefits {
  margin-top: 14px;
  color: var(--admin-text);
}

.membership-purchase-detail__benefits ul {
  margin: 8px 0 0;
  padding-left: 20px;
}

.membership-purchase-detail__muted {
  margin: 0;
  color: var(--admin-muted);
}

.membership-purchase-detail__action-error {
  margin-top: 12px;
}

.membership-purchase-detail__actions {
  position: sticky;
  z-index: 2;
  bottom: -20px;
  display: flex;
  justify-content: flex-end;
  margin: 0 -24px -20px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--admin-border);
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 -8px 20px rgb(73 57 105 / 6%);
  backdrop-filter: blur(8px);
}
</style>
