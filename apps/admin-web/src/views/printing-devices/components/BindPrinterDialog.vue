<script setup lang="ts">
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus';

import type { BindPrinterForm } from '../type/index.js';

const props = defineProps<{
  readonly visible: boolean;
  readonly form: BindPrinterForm;
  readonly submitting: boolean;
}>();
const emit = defineEmits<{
  close: [];
  'update:form': [form: BindPrinterForm];
  submit: [];
}>();

function updateForm(patch: Partial<BindPrinterForm>): void {
  emit('update:form', { ...props.form, ...patch });
}
</script>

<template>
  <ElDialog
    :model-value="visible"
    title="绑定打印机"
    width="min(92vw, 520px)"
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    @close="emit('close')"
  >
    <p class="printer-dialog__hint">
      提交后设备将打印一次性验证码。序列号和操作密码会立即从页面内存清除。
    </p>
    <ElForm label-position="top" @submit.prevent="emit('submit')">
      <ElFormItem label="设备序列号">
        <ElInput
          :model-value="form.serialNumber"
          autocomplete="off"
          maxlength="64"
          data-testid="bind-printer-serial"
          placeholder="例如 SN-1001"
          @update:model-value="updateForm({ serialNumber: String($event) })"
        />
      </ElFormItem>
      <ElFormItem label="显示名称">
        <ElInput
          :model-value="form.displayName"
          maxlength="64"
          show-word-limit
          placeholder="例如 前台出单机"
          @update:model-value="updateForm({ displayName: String($event) })"
        />
      </ElFormItem>
      <ElFormItem label="当前账号操作密码">
        <ElInput
          :model-value="form.operationPassword"
          type="password"
          autocomplete="current-password"
          show-password
          @update:model-value="
            updateForm({ operationPassword: String($event) })
          "
        />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton :disabled="submitting" @click="emit('close')">取消</ElButton>
      <ElButton type="primary" :loading="submitting" @click="emit('submit')">
        {{ submitting ? '绑定中…' : '开始绑定' }}
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.printer-dialog__hint {
  margin: -4px 0 20px;
  padding: 13px 15px;
  border-radius: 12px;
  background: var(--admin-primary-soft);
  color: var(--admin-muted);
  font-size: 13px;
  line-height: 1.7;
}
</style>
