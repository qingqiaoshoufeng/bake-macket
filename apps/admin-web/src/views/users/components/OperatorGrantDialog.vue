<script setup lang="ts">
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus';

import type { AdminUserView, OperatorGrantForm } from '../type/index.js';

const props = defineProps<{
  readonly visible: boolean;
  readonly user: AdminUserView | null;
  readonly form: OperatorGrantForm;
  readonly submitting: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'update:form': [form: OperatorGrantForm];
  submit: [];
}>();

function updateForm(patch: Partial<OperatorGrantForm>): void {
  emit('update:form', { ...props.form, ...patch });
}
</script>

<template>
  <ElDialog
    :model-value="visible"
    title="授权操作员"
    width="min(92vw, 520px)"
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    @close="emit('close')"
  >
    <div class="operator-dialog__notice">
      <strong>{{
        user?.nickname || user?.identityPhoneMasked || '当前用户'
      }}</strong>
      将获得订单、用户和打印白名单权限，并在首次登录时强制修改临时密码。
      管理员登录手机号与顾客身份手机号、订单联系手机号相互独立。
    </div>
    <ElForm label-position="top" @submit.prevent="emit('submit')">
      <ElFormItem label="管理员登录手机号">
        <ElInput
          :model-value="form.loginPhone"
          type="tel"
          inputmode="numeric"
          autocomplete="username"
          maxlength="11"
          placeholder="请输入独立的 11 位登录手机号"
          data-testid="operator-login-phone"
          @update:model-value="updateForm({ loginPhone: String($event) })"
        />
      </ElFormItem>
      <ElFormItem label="当前超级管理员密码">
        <ElInput
          :model-value="form.currentPassword"
          type="password"
          autocomplete="current-password"
          show-password
          @update:model-value="updateForm({ currentPassword: String($event) })"
        />
      </ElFormItem>
      <ElFormItem label="临时密码">
        <ElInput
          :model-value="form.temporaryPassword"
          type="password"
          inputmode="numeric"
          autocomplete="new-password"
          show-password
          placeholder="至少 6 位数字"
          @update:model-value="
            updateForm({ temporaryPassword: String($event) })
          "
        />
      </ElFormItem>
      <ElFormItem label="确认临时密码">
        <ElInput
          :model-value="form.confirmTemporaryPassword"
          type="password"
          inputmode="numeric"
          autocomplete="new-password"
          show-password
          @update:model-value="
            updateForm({ confirmTemporaryPassword: String($event) })
          "
        />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton :disabled="submitting" @click="emit('close')">取消</ElButton>
      <ElButton
        type="primary"
        :loading="submitting"
        data-testid="grant-operator-submit"
        @click="emit('submit')"
      >
        {{ submitting ? '授权中…' : '确认授权' }}
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.operator-dialog__notice {
  margin: -4px 0 20px;
  padding: 14px 16px;
  background: var(--admin-primary-soft);
  border-radius: 12px;
  color: var(--admin-muted);
  font-size: 13px;
  line-height: 1.7;
}

.operator-dialog__notice strong {
  color: var(--admin-text);
}
</style>
