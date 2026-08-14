<script setup lang="ts">
import { ElButton, ElEmpty, ElTable, ElTableColumn, ElTag } from 'element-plus';

import { USER_COLUMNS } from '../config/columns.js';
import type { AdminUserView } from '../type/index.js';

const props = defineProps<{
  readonly users: readonly AdminUserView[];
  readonly loading: boolean;
  readonly canManageRoles: boolean;
}>();

const emit = defineEmits<{
  grant: [user: AdminUserView];
  revoke: [user: AdminUserView];
}>();

function asAdminUser(row: unknown): AdminUserView {
  return row as AdminUserView;
}

function displayName(user: AdminUserView): string {
  return user.nickname?.trim() || '未设置昵称';
}

function operatorLabel(user: AdminUserView): string {
  if (!user.isOperator) return '普通用户';
  if (!user.operatorActive) return '操作员已停用';
  return user.mustChangePassword ? '待首次改密' : '操作员正常';
}

function operatorTagType(
  user: AdminUserView,
): 'success' | 'warning' | 'info' | 'danger' {
  if (!user.isOperator) return 'info';
  if (!user.operatorActive) return 'danger';
  return user.mustChangePassword ? 'warning' : 'success';
}

function createdAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
}
</script>

<template>
  <ElTable
    v-if="users.length > 0 || loading"
    v-loading="loading"
    :data="[...users]"
    row-key="id"
    class="user-table"
  >
    <ElTableColumn
      v-for="column in USER_COLUMNS"
      :key="column.key"
      :label="column.label"
      :min-width="column.minWidth"
      :width="column.width"
    >
      <template #default="{ row }">
        <div v-if="column.key === 'identity'" class="user-table__identity">
          <span class="user-table__avatar" aria-hidden="true">
            {{ displayName(asAdminUser(row)).slice(0, 1) }}
          </span>
          <div>
            <strong>{{ displayName(asAdminUser(row)) }}</strong>
            <small>ID {{ row.id }}</small>
          </div>
        </div>
        <span v-else-if="column.key === 'phone'">
          {{ row.phoneMasked ?? '未绑定' }}
        </span>
        <ElTag
          v-else-if="column.key === 'verified'"
          :type="row.phoneVerified ? 'success' : 'info'"
          effect="light"
          round
        >
          {{ row.phoneVerified ? '已验证' : '待验证' }}
        </ElTag>
        <ElTag
          v-else-if="column.key === 'operator'"
          :type="operatorTagType(asAdminUser(row))"
          effect="light"
          round
        >
          {{ operatorLabel(asAdminUser(row)) }}
        </ElTag>
        <span v-else-if="column.key === 'createdAt'">
          {{ createdAt(row.createdAt) }}
        </span>
        <div v-else-if="column.key === 'actions'" class="user-table__actions">
          <template v-if="props.canManageRoles">
            <ElButton
              v-if="!row.operatorActive"
              type="primary"
              link
              data-testid="grant-operator"
              @click="emit('grant', asAdminUser(row))"
            >
              授权操作员
            </ElButton>
            <ElButton
              v-else
              type="danger"
              link
              data-testid="revoke-operator"
              @click="emit('revoke', asAdminUser(row))"
            >
              撤销操作员
            </ElButton>
          </template>
          <span v-else class="user-table__readonly">仅查看</span>
        </div>
      </template>
    </ElTableColumn>
  </ElTable>
  <ElEmpty v-else description="暂无符合条件的用户" class="user-table__empty" />
</template>

<style scoped>
.user-table {
  width: 100%;
}

.user-table :deep(.el-table__header th) {
  background: var(--admin-surface-soft);
  color: var(--admin-muted);
  font-size: 12px;
}

.user-table__identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-table__avatar {
  display: grid;
  flex: none;
  width: 38px;
  height: 38px;
  place-items: center;
  background: linear-gradient(145deg, var(--admin-primary-soft), #fff5f8);
  border: 1px solid var(--admin-border);
  border-radius: 13px;
  color: var(--admin-primary);
  font-weight: 750;
}

.user-table__identity strong,
.user-table__identity small {
  display: block;
}

.user-table__identity strong {
  color: var(--admin-text);
}

.user-table__identity small {
  margin-top: 3px;
  color: var(--admin-muted);
  font-size: 11px;
}

.user-table__actions {
  display: flex;
  align-items: center;
}

.user-table__readonly {
  color: var(--admin-muted);
  font-size: 12px;
}

.user-table__empty {
  padding: 52px 20px;
}
</style>
