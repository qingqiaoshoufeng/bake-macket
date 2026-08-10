<script setup lang="ts">
import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  type CloudPrinterView,
} from '@bake-mall/contracts';
import { ElButton, ElEmpty, ElTable, ElTableColumn, ElTag } from 'element-plus';

import {
  actionsForPrinter,
  PRINTER_ACTION_LABELS,
  type PrinterAction,
} from '../config/actions.js';
import { PRINTER_COLUMNS } from '../config/columns.js';

defineProps<{
  readonly devices: readonly CloudPrinterView[];
  readonly loading: boolean;
  readonly pendingResourceIds: readonly string[];
}>();

const emit = defineEmits<{
  action: [action: PrinterAction, printer: CloudPrinterView];
}>();

const STATUS_LABELS: Readonly<Record<CloudPrinterStatus, string>> = {
  [CloudPrinterStatus.BINDING]: '绑定中',
  [CloudPrinterStatus.PENDING_VERIFICATION]: '待验证码确认',
  [CloudPrinterStatus.ACTIVE]: '已启用',
  [CloudPrinterStatus.UNBINDING]: '解绑中',
  [CloudPrinterStatus.UNBOUND]: '已解绑',
  [CloudPrinterStatus.ERROR]: '需恢复',
};
const ONLINE_LABELS: Readonly<Record<CloudPrinterOnlineStatus, string>> = {
  [CloudPrinterOnlineStatus.UNKNOWN]: '未知',
  [CloudPrinterOnlineStatus.OFFLINE]: '离线',
  [CloudPrinterOnlineStatus.ONLINE]: '在线',
  [CloudPrinterOnlineStatus.ABNORMAL]: '异常',
};
function asPrinter(value: unknown): CloudPrinterView {
  return value as CloudPrinterView;
}

function statusType(
  status: CloudPrinterStatus,
): 'success' | 'warning' | 'danger' | 'info' {
  if (status === CloudPrinterStatus.ACTIVE) return 'success';
  if (
    status === CloudPrinterStatus.BINDING ||
    status === CloudPrinterStatus.PENDING_VERIFICATION
  ) {
    return 'warning';
  }
  return status === CloudPrinterStatus.ERROR ? 'danger' : 'info';
}

function onlineType(
  status: CloudPrinterOnlineStatus,
): 'success' | 'warning' | 'danger' | 'info' {
  if (status === CloudPrinterOnlineStatus.ONLINE) return 'success';
  if (status === CloudPrinterOnlineStatus.OFFLINE) return 'info';
  return status === CloudPrinterOnlineStatus.ABNORMAL ? 'danger' : 'warning';
}

function formatCheckedAt(value: string | null): string {
  if (!value) return '尚未检查';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '尚未检查'
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
    v-if="devices.length > 0 || loading"
    v-loading="loading"
    :data="[...devices]"
    row-key="id"
    class="printer-table"
  >
    <ElTableColumn
      v-for="column in PRINTER_COLUMNS"
      :key="column.key"
      :label="column.label"
      :min-width="column.minWidth"
      :width="column.width"
    >
      <template #default="{ row }">
        <div v-if="column.key === 'identity'" class="printer-table__identity">
          <span class="printer-table__icon" aria-hidden="true">P</span>
          <div>
            <strong>{{ row.displayName }}</strong>
            <small>{{ row.serialNumberMasked }} · ID {{ row.id }}</small>
          </div>
        </div>
        <ElTag
          v-else-if="column.key === 'binding'"
          :type="statusType(row.status)"
          effect="light"
          round
        >
          {{ STATUS_LABELS[row.status as CloudPrinterStatus] }}
        </ElTag>
        <ElTag
          v-else-if="column.key === 'online'"
          :type="onlineType(row.onlineStatus)"
          effect="light"
          round
        >
          {{ ONLINE_LABELS[row.onlineStatus as CloudPrinterOnlineStatus] }}
        </ElTag>
        <span v-else-if="column.key === 'checkedAt'">
          {{ formatCheckedAt(row.lastStatusCheckedAt) }}
        </span>
        <div
          v-else-if="column.key === 'actions'"
          class="printer-table__actions"
        >
          <ElButton
            v-for="action in actionsForPrinter(asPrinter(row))"
            :key="action"
            type="primary"
            link
            :loading="pendingResourceIds.includes(row.id)"
            :data-printer-action="action"
            @click="emit('action', action, asPrinter(row))"
          >
            {{ PRINTER_ACTION_LABELS[action] }}
          </ElButton>
          <span class="printer-table__unbind">
            <ElButton disabled link :data-testid="`unbind-printer-${row.id}`">
              解绑
            </ElButton>
            <small>将在打印任务基础完成后开放</small>
          </span>
        </div>
      </template>
    </ElTableColumn>
  </ElTable>
  <ElEmpty v-else description="暂无打印设备" class="printer-table__empty" />
</template>

<style scoped>
.printer-table {
  width: 100%;
}

.printer-table :deep(.el-table__header th) {
  background: var(--admin-surface-soft);
  color: var(--admin-muted);
  font-size: 12px;
}

.printer-table__identity,
.printer-table__actions,
.printer-table__unbind {
  display: flex;
  align-items: center;
}

.printer-table__identity {
  gap: 12px;
}

.printer-table__icon {
  display: grid;
  flex: none;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid var(--admin-border);
  border-radius: 14px;
  background: linear-gradient(145deg, var(--admin-primary-soft), #effdf7);
  color: var(--admin-primary);
  font-weight: 800;
}

.printer-table__identity strong,
.printer-table__identity small {
  display: block;
}

.printer-table__identity small,
.printer-table__unbind small {
  margin-top: 3px;
  color: var(--admin-muted);
  font-size: 11px;
}

.printer-table__actions {
  flex-wrap: wrap;
  gap: 2px 8px;
}

.printer-table__unbind {
  align-items: flex-start;
  flex-direction: column;
}

.printer-table__unbind :deep(.el-button) {
  margin-left: 0;
}

.printer-table__empty {
  padding: 52px 20px;
}
</style>
