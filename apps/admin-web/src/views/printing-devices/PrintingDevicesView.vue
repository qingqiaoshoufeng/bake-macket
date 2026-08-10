<script setup lang="ts">
import { ElAlert, ElButton, ElMessage, ElPagination } from 'element-plus';
import { computed, onMounted } from 'vue';

import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import { useAdminAuthStore } from '../../stores/admin-auth.js';
import BindPrinterDialog from './components/BindPrinterDialog.vue';
import PrinterRecoveryActions from './components/PrinterRecoveryActions.vue';
import PrinterTable from './components/PrinterTable.vue';
import RenamePrinterDialog from './components/RenamePrinterDialog.vue';
import VerifyPrinterDialog from './components/VerifyPrinterDialog.vue';
import { PRINTER_PAGINATION } from './config/defaults.js';
import {
  adminIdFromAccessToken,
  usePrintingDevices,
} from './hooks/usePrintingDevices.js';
import type {
  BindPrinterForm,
  CloudPrinterView,
  RecoveryPrinterForm,
  RenamePrinterForm,
  VerifyPrinterForm,
} from './type/index.js';

const auth = useAdminAuthStore();
const adminId = computed(() => adminIdFromAccessToken(auth.accessToken));
const state = usePrintingDevices({ adminId });
const selectedPrinter = computed(
  () =>
    state.devices.value.find(
      (printer) => printer.id === state.dialog.value.resourceId,
    ) ?? null,
);

onMounted(async () => {
  try {
    await state.load();
  } catch {
    // The persistent alert renders the classified hook error.
  }
});

async function perform(
  operation: () => Promise<unknown>,
  successMessage: string,
): Promise<void> {
  try {
    await operation();
    ElMessage.success(successMessage);
  } catch {
    // The hook distinguishes stable, unknown, and retryable outcomes.
  }
}

function handleAction(
  action:
    'verify' | 'resend' | 'refresh' | 'requery' | 'delete-confirm' | 'rename',
  printer: CloudPrinterView,
): void {
  if (action === 'verify') state.openVerify(printer);
  else if (action === 'refresh') {
    void perform(() => state.refreshOnlineStatus(printer.id), '在线状态已刷新');
  } else if (action === 'rename') state.openRename(printer);
  else state.openRecovery(action, printer);
}

function matchingPending(
  operation:
    | 'bind'
    | 'confirm'
    | 'resend'
    | 'refresh'
    | 'requery'
    | 'delete-confirm'
    | 'rename',
  resourceId?: string,
) {
  return state.pendingOperations.value.find(
    (candidate) =>
      candidate.operation === operation && candidate.resourceId === resourceId,
  );
}

function submitBind(): void {
  const operation = matchingPending('bind');
  void perform(
    operation ? () => state.retryOperation('bind') : state.bind,
    '绑定请求已提交，请查看纸面验证码',
  );
}

function submitVerify(): void {
  const printerId = state.dialog.value.resourceId;
  if (!printerId) return;
  const operation = matchingPending('confirm', printerId);
  void perform(
    operation
      ? () => state.retryOperation('confirm', printerId)
      : () => state.confirm(printerId),
    '打印机验证成功',
  );
}

function submitRecovery(): void {
  const action = state.dialog.value.recoveryAction;
  const printerId = state.dialog.value.resourceId;
  if (!action || !printerId) return;
  const operations = {
    resend: () => state.resend(printerId),
    requery: () => state.requery(printerId),
    'delete-confirm': () => state.confirmDeletion(printerId),
  } as const;
  const operation = matchingPending(action, printerId);
  void perform(
    operation
      ? () => state.retryOperation(action, printerId)
      : operations[action],
    '设备恢复操作已提交',
  );
}

function submitRename(): void {
  const printerId = state.dialog.value.resourceId;
  if (!printerId) return;
  const operation = matchingPending('rename', printerId);
  void perform(
    operation
      ? () => state.retryOperation('rename', printerId)
      : () => state.rename(printerId),
    '打印机名称已更新',
  );
}

function continuePendingOperation(): void {
  const pending = state.pendingOperations.value[0];
  if (!pending) return;
  if (pending.operation === 'refresh' && pending.resourceId) {
    void perform(
      () => state.retryOperation('refresh', pending.resourceId),
      '在线状态已刷新',
    );
    return;
  }
  if (pending.operation === 'bind') {
    state.openBind();
    return;
  }
  const printer = state.devices.value.find(
    (candidate) => candidate.id === pending.resourceId,
  );
  if (!printer) return;
  if (pending.operation === 'confirm') state.openVerify(printer);
  else if (pending.operation === 'rename') state.openRename(printer);
  else if (
    pending.operation === 'resend' ||
    pending.operation === 'requery' ||
    pending.operation === 'delete-confirm'
  ) {
    state.openRecovery(pending.operation, printer);
  }
}

function openExpiredRecovery(): void {
  if (selectedPrinter.value) {
    state.openRecovery('resend', selectedPrinter.value);
  }
}
</script>

<template>
  <AdminPage workspace class="printing-devices-page">
    <template #header>
      <AdminPageHeader
        eyebrow="PRINTING STATION"
        title="打印设备"
        description="绑定芯烨云打印机，完成纸面验证码确认，并安全处理厂商状态恢复。"
      >
        <template #actions>
          <ElButton
            type="primary"
            data-testid="open-bind-printer"
            @click="state.openBind"
          >
            绑定打印机
          </ElButton>
        </template>
      </AdminPageHeader>
    </template>

    <template v-if="state.error.value" #alert>
      <ElAlert
        :type="state.error.value.kind === 'stable' ? 'error' : 'warning'"
        :title="state.error.value.message"
        :closable="false"
        show-icon
      >
        <template v-if="state.pendingOperations.value.length > 0" #default>
          <div class="printing-devices-page__pending">
            <span>
              {{
                state.error.value.kind === 'unknown'
                  ? '服务器尚未给出稳定结果，请勿创建不同请求。'
                  : '可沿用原幂等键安全重试。'
              }}
            </span>
            <ElButton size="small" @click="continuePendingOperation">
              继续原操作
            </ElButton>
          </div>
        </template>
      </ElAlert>
    </template>

    <AdminDataPanel fill>
      <template #toolbar>
        <div class="printing-devices-page__toolbar">
          <div>
            <strong>设备工作台</strong>
            <span>仅展示服务端脱敏序列号；恢复动作由设备状态决定。</span>
          </div>
          <ElButton :loading="state.loading.value" @click="state.load">
            刷新列表
          </ElButton>
        </div>
      </template>

      <PrinterTable
        :devices="state.devices.value"
        :loading="state.loading.value"
        :pending-resource-ids="state.pendingResourceIds.value"
        @action="handleAction"
      />

      <template v-if="state.total.value > 0" #footer>
        <ElPagination
          background
          layout="total, sizes, prev, pager, next"
          :total="state.total.value"
          :current-page="state.page.value"
          :page-size="state.pageSize.value"
          :page-sizes="[...PRINTER_PAGINATION.pageSizes]"
          @update:current-page="state.setPage"
          @update:page-size="state.setPageSize"
        />
      </template>
    </AdminDataPanel>

    <BindPrinterDialog
      :visible="state.dialog.value.kind === 'bind'"
      :form="state.bindForm.value"
      :submitting="state.submitting.value"
      @close="state.closeDialog"
      @update:form="state.bindForm.value = $event as BindPrinterForm"
      @submit="submitBind"
    />
    <VerifyPrinterDialog
      :visible="state.dialog.value.kind === 'verify'"
      :form="state.verifyForm.value"
      :challenge="state.challenge.value"
      :challenge-state="state.challengeState.value"
      :allow-manual-retry="
        Boolean(matchingPending('confirm', state.dialog.value.resourceId))
      "
      :countdown-seconds="state.countdownSeconds.value"
      :submitting="state.submitting.value"
      @close="state.closeDialog"
      @update:form="state.verifyForm.value = $event as VerifyPrinterForm"
      @submit="submitVerify"
      @recovery="openExpiredRecovery"
    />
    <PrinterRecoveryActions
      :visible="state.dialog.value.kind === 'recovery'"
      :action="state.dialog.value.recoveryAction ?? 'requery'"
      :printer-name="selectedPrinter?.displayName ?? '当前打印机'"
      :form="state.recoveryForm.value"
      :submitting="state.submitting.value"
      @close="state.closeDialog"
      @update:form="state.recoveryForm.value = $event as RecoveryPrinterForm"
      @submit="submitRecovery"
    />
    <RenamePrinterDialog
      :visible="state.dialog.value.kind === 'rename'"
      :printer-name="selectedPrinter?.displayName ?? '当前打印机'"
      :form="state.renameForm.value"
      :submitting="state.submitting.value"
      @close="state.closeDialog"
      @update:form="state.renameForm.value = $event as RenamePrinterForm"
      @submit="submitRename"
    />
  </AdminPage>
</template>

<style scoped>
.printing-devices-page__toolbar,
.printing-devices-page__pending {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
}

.printing-devices-page__toolbar div {
  display: grid;
  gap: 3px;
}

.printing-devices-page__toolbar strong {
  color: var(--admin-text);
}

.printing-devices-page__toolbar span,
.printing-devices-page__pending span {
  color: var(--admin-muted);
  font-size: 12px;
}

@media (max-width: 720px) {
  .printing-devices-page__toolbar,
  .printing-devices-page__pending {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
