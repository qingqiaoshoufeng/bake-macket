<script setup lang="ts">
import {
  ElButton,
  ElCheckbox,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
} from 'element-plus';

import type { AdminUserView, OperatorRevokeForm } from '../type/index.js';

const props = defineProps<{
  readonly visible: boolean;
  readonly user: AdminUserView | null;
  readonly form: OperatorRevokeForm;
  readonly submitting: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'update:form': [form: OperatorRevokeForm];
  submit: [];
}>();

function updateForm(patch: Partial<OperatorRevokeForm>): void {
  emit('update:form', { ...props.form, ...patch });
}
</script>

<template>
  <ElDialog
    :model-value="visible"
    title="撤销操作员"
    width="min(92vw, 500px)"
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    @close="emit('close')"
  >
    <div class="operator-revoke__warning">
      撤销后，{{ user?.nickname || user?.phoneMasked || '该用户' }}
      的现有后台会话将失效，且无法继续访问管理功能。
    </div>
    <ElForm label-position="top" @submit.prevent="emit('submit')">
      <ElFormItem label="当前超级管理员密码">
        <ElInput
          :model-value="form.currentPassword"
          type="password"
          autocomplete="current-password"
          show-password
          @update:model-value="updateForm({ currentPassword: String($event) })"
        />
      </ElFormItem>
      <ElCheckbox
        :model-value="form.acknowledged"
        data-testid="revoke-operator-acknowledged"
        @update:model-value="updateForm({ acknowledged: Boolean($event) })"
      >
        我已了解撤销会立即终止该操作员的后台权限
      </ElCheckbox>
    </ElForm>
    <template #footer>
      <ElButton :disabled="submitting" @click="emit('close')">取消</ElButton>
      <ElButton
        type="danger"
        :loading="submitting"
        data-testid="revoke-operator-submit"
        @click="emit('submit')"
      >
        {{ submitting ? '撤销中…' : '确认撤销' }}
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.operator-revoke__warning {
  margin: -4px 0 20px;
  padding: 14px 16px;
  background: #fff7f8;
  border: 1px solid rgb(180 63 102 / 15%);
  border-radius: 12px;
  color: var(--admin-danger);
  font-size: 13px;
  line-height: 1.7;
}
</style>
