<script setup lang="ts">
import {
  MembershipLevelStatus,
  type AdminMembershipLevelListItem,
} from '@bake-mall/contracts';
import { ElButton, ElTable, ElTableColumn, ElTag } from 'element-plus';

import AdminEmptyState from '../../../components/feedback/AdminEmptyState.vue';
import { formatDateTime } from '../../../utils/date.js';
import {
  basisPointsToDiscountText,
  centsToYuanText,
  formatPriceCents,
} from '../../../utils/money.js';
import { MEMBERSHIP_CARD_COLUMNS } from '../config/columns.js';
import { canDeleteMembershipLevel } from '../hooks/useMembershipCards.js';
import MembershipCardPreview from './MembershipCardPreview.vue';

defineProps<{
  readonly levels: readonly AdminMembershipLevelListItem[];
  readonly loading: boolean;
  readonly actionId: string | null;
}>();

const emit = defineEmits<{
  edit: [id: string];
  toggle: [level: AdminMembershipLevelListItem];
  remove: [level: AdminMembershipLevelListItem];
}>();

function rowOf(scope: unknown): AdminMembershipLevelListItem {
  return (scope as { row: AdminMembershipLevelListItem }).row;
}

const [
  levelColumn,
  rankColumn,
  priceColumn,
  discountColumn,
  validDaysColumn,
  purchaseCountColumn,
  statusColumn,
  versionColumn,
  updatedAtColumn,
  actionsColumn,
] = MEMBERSHIP_CARD_COLUMNS;
</script>

<template>
  <ElTable
    v-loading="loading"
    :data="[...levels]"
    row-key="id"
    class="admin-table membership-card-table"
    :empty-text="loading ? '加载中…' : '暂无会员卡配置'"
  >
    <ElTableColumn :label="levelColumn.label" :min-width="levelColumn.minWidth">
      <template #default="scope">
        <div class="membership-card-table__level">
          <button
            type="button"
            class="membership-card-table__preview-button"
            :aria-label="`预览并编辑 ${rowOf(scope).name}`"
            @click="emit('edit', rowOf(scope).id)"
          >
            <MembershipCardPreview
              compact
              :name="rowOf(scope).name"
              :subtitle="rowOf(scope).subtitle"
              :badge-text="rowOf(scope).cardTheme.badgeText"
              :theme="rowOf(scope).cardTheme.theme"
              :discount-text="
                basisPointsToDiscountText(rowOf(scope).discountBasisPoints)
              "
              :price-yuan="centsToYuanText(rowOf(scope).priceCents)"
              :grant-credit-yuan="
                centsToYuanText(rowOf(scope).grantCreditCents)
              "
              :valid-days="rowOf(scope).validDays"
            />
          </button>
          <div>
            <strong>{{ rowOf(scope).name }}</strong>
            <span
              >{{ rowOf(scope).code }} · sortOrder
              {{ rowOf(scope).sortOrder }}</span
            >
          </div>
        </div>
      </template>
    </ElTableColumn>
    <ElTableColumn :label="rankColumn.label" :width="rankColumn.width">
      <template #default="scope">{{ rowOf(scope).rank }}</template>
    </ElTableColumn>
    <ElTableColumn :label="priceColumn.label" :min-width="priceColumn.minWidth">
      <template #default="scope">
        <div class="membership-card-table__money">
          <strong>{{ formatPriceCents(rowOf(scope).priceCents) }}</strong>
          <span>赠 {{ formatPriceCents(rowOf(scope).grantCreditCents) }}</span>
        </div>
      </template>
    </ElTableColumn>
    <ElTableColumn :label="discountColumn.label" :width="discountColumn.width">
      <template #default="scope">
        {{ basisPointsToDiscountText(rowOf(scope).discountBasisPoints) }} 折
      </template>
    </ElTableColumn>
    <ElTableColumn
      :label="validDaysColumn.label"
      :width="validDaysColumn.width"
    >
      <template #default="scope">{{ rowOf(scope).validDays }} 天</template>
    </ElTableColumn>
    <ElTableColumn
      :label="purchaseCountColumn.label"
      :width="purchaseCountColumn.width"
    >
      <template #default="scope">{{ rowOf(scope).purchaseCount }}</template>
    </ElTableColumn>
    <ElTableColumn :label="statusColumn.label" :width="statusColumn.width">
      <template #default="scope">
        <ElTag
          :type="
            rowOf(scope).status === MembershipLevelStatus.ACTIVE
              ? 'success'
              : 'info'
          "
        >
          {{
            rowOf(scope).status === MembershipLevelStatus.ACTIVE
              ? '已上架'
              : '下架草稿'
          }}
        </ElTag>
      </template>
    </ElTableColumn>
    <ElTableColumn :label="versionColumn.label" :width="versionColumn.width">
      <template #default="scope">v{{ rowOf(scope).version }}</template>
    </ElTableColumn>
    <ElTableColumn
      :label="updatedAtColumn.label"
      :min-width="updatedAtColumn.minWidth"
    >
      <template #default="scope">{{
        formatDateTime(rowOf(scope).updatedAt)
      }}</template>
    </ElTableColumn>
    <ElTableColumn
      :label="actionsColumn.label"
      :width="actionsColumn.width"
      fixed="right"
    >
      <template #default="scope">
        <ElButton size="small" @click="emit('edit', rowOf(scope).id)"
          >编辑</ElButton
        >
        <ElButton
          size="small"
          :type="
            rowOf(scope).status === MembershipLevelStatus.ACTIVE
              ? 'warning'
              : 'success'
          "
          plain
          :loading="actionId === rowOf(scope).id"
          @click="emit('toggle', rowOf(scope))"
        >
          {{
            rowOf(scope).status === MembershipLevelStatus.ACTIVE
              ? '下架'
              : '上架'
          }}
        </ElButton>
        <ElButton
          v-if="canDeleteMembershipLevel(rowOf(scope))"
          size="small"
          type="danger"
          plain
          :loading="actionId === rowOf(scope).id"
          :data-testid="`delete-membership-${rowOf(scope).id}`"
          @click="emit('remove', rowOf(scope))"
        >
          删除草稿
        </ElButton>
      </template>
    </ElTableColumn>
    <template #empty>
      <AdminEmptyState
        v-if="!loading"
        title="还没有会员卡配方"
        description="新建一张下架草稿，预览确认后再上架。"
        tone="mint"
      />
    </template>
  </ElTable>
</template>

<style scoped>
.membership-card-table {
  min-width: 1280px;
}

.membership-card-table__level,
.membership-card-table__money {
  display: grid;
  gap: 5px;
}

.membership-card-table__level strong,
.membership-card-table__level span,
.membership-card-table__money strong,
.membership-card-table__money span {
  display: block;
}

.membership-card-table__level span,
.membership-card-table__money span {
  color: var(--admin-muted);
  font-size: 11px;
}

.membership-card-table__preview-button {
  width: 160px;
  margin: 0 0 10px;
  padding: 0;
  border: 0;
  border-radius: 18px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.membership-card-table__preview-button:focus-visible {
  outline: 3px solid var(--admin-primary);
  outline-offset: 3px;
}

.membership-card-table__preview-button :deep(.membership-card-preview) {
  min-height: 130px;
  transform: none;
}

.membership-card-table__preview-button :deep(.membership-card-preview__body p),
.membership-card-table__preview-button :deep(.membership-card-preview__measure),
.membership-card-table__preview-button :deep(.membership-card-preview__foot) {
  display: none;
}
</style>
