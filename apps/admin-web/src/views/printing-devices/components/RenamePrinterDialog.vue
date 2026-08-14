<script setup lang="ts">
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus';

import type { RenamePrinterForm } from '../type/index.js';

defineProps<{
  readonly visible: boolean;
  readonly printerName: string;
  readonly form: RenamePrinterForm;
  readonly submitting: boolean;
}>();
const emit = defineEmits<{
  close: [];
  'update:form': [form: RenamePrinterForm];
  submit: [];
}>();
</script>

<template>
  <ElDialog
    :model-value="visible"
    title="重命名打印机"
    width="min(92vw, 480px)"
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    @close="emit('close')"
  >
    <p class="rename-printer__hint">当前名称：{{ printerName }}</p>
    <ElForm label-position="top" @submit.prevent="emit('submit')">
      <ElFormItem label="新名称">
        <ElInput
          :model-value="form.displayName"
          maxlength="64"
          show-word-limit
          @update:model-value="
            emit('update:form', { displayName: String($event) })
          "
        />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton :disabled="submitting" @click="emit('close')">取消</ElButton>
      <ElButton type="primary" :loading="submitting" @click="emit('submit')">
        保存名称
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.rename-printer__hint {
  margin: -4px 0 18px;
  color: var(--admin-muted);
  font-size: 13px;
}
</style>
