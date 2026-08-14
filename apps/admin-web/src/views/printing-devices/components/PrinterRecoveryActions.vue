<script setup lang="ts">
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus';

import type { RecoveryPrinterForm } from '../type/index.js';

const props = defineProps<{
  readonly visible: boolean;
  readonly action: 'resend' | 'requery' | 'delete-confirm';
  readonly printerName: string;
  readonly form: RecoveryPrinterForm;
  readonly submitting: boolean;
}>();
const emit = defineEmits<{
  close: [];
  'update:form': [form: RecoveryPrinterForm];
  submit: [];
}>();

const labels = {
  resend: '重发纸面验证码',
  requery: '重新查询厂商关系',
  'delete-confirm': '确认补偿删除',
} as const;

function updatePassword(operationPassword: string): void {
  emit('update:form', { ...props.form, operationPassword });
}
</script>

<template>
  <ElDialog
    :model-value="visible"
    :title="labels[action]"
    width="min(92vw, 500px)"
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    @close="emit('close')"
  >
    <p class="printer-recovery__notice">
      设备：<strong>{{ printerName }}</strong
      >。该操作会向厂商确认现状，请输入当前账号操作密码。
    </p>
    <ElForm label-position="top" @submit.prevent="emit('submit')">
      <ElFormItem label="当前账号操作密码">
        <ElInput
          :model-value="form.operationPassword"
          type="password"
          autocomplete="current-password"
          show-password
          @update:model-value="updatePassword(String($event))"
        />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton :disabled="submitting" @click="emit('close')">取消</ElButton>
      <ElButton type="primary" :loading="submitting" @click="emit('submit')">
        {{ labels[action] }}
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.printer-recovery__notice {
  margin: -4px 0 20px;
  padding: 14px 16px;
  border-radius: 12px;
  background: #fff8ed;
  color: var(--admin-muted);
  font-size: 13px;
  line-height: 1.7;
}

.printer-recovery__notice strong {
  color: var(--admin-text);
}
</style>
