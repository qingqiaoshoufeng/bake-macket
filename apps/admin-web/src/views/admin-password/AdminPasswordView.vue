<script setup lang="ts">
import { ApiErrorCode } from '@bake-mall/contracts';
import { ElMessage } from 'element-plus';
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import { ApiClientError } from '../../api/http.js';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import PasswordForm from './components/PasswordForm.vue';
import { useAdminPassword } from './hooks/useAdminPassword.js';

const router = useRouter();
const password = useAdminPassword();
const title = computed(() =>
  password.mode.value === 'initial' ? '首次修改密码' : '修改密码',
);
const description = computed(() =>
  password.mode.value === 'initial'
    ? '完成密码更新后，订单与打印等操作权限才会启用。'
    : '使用当前密码验证身份，并设置新的后台登录密码。',
);

const API_ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  [ApiErrorCode.ADMIN_PASSWORD_POLICY_VIOLATION]:
    '新密码不符合要求，请使用至少 6 位数字',
  [ApiErrorCode.ADMIN_VERIFICATION_FAILED]: '当前密码不正确',
  [ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED]: '尝试次数过多，请稍后重试',
  [ApiErrorCode.ADMIN_PASSWORD_CHANGE_REQUIRED]:
    '当前会话不支持此操作，请重新登录',
};

const LOCAL_ERROR_MESSAGES = new Set([
  '请完整填写三个密码字段',
  '两次输入的新密码不一致',
  '管理员会话已失效，请重新登录',
]);

function safeErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return (
      (error.code && API_ERROR_MESSAGES[error.code]) ??
      '密码修改失败，请稍后重试'
    );
  }
  return error instanceof Error && LOCAL_ERROR_MESSAGES.has(error.message)
    ? error.message
    : '密码修改失败，请稍后重试';
}

async function submit(): Promise<void> {
  try {
    await password.submit();
    ElMessage.success('密码修改成功');
    await router.replace('/orders');
  } catch (error) {
    ElMessage.error(safeErrorMessage(error));
  }
}
</script>

<template>
  <AdminPage class="admin-password-view">
    <AdminPageHeader
      eyebrow="ACCOUNT SECURITY"
      :title="title"
      :description="description"
    />
    <PasswordForm
      :form="password.form.value"
      :mode="password.mode.value"
      :submitting="password.submitting.value"
      @update:form="password.replaceForm"
      @submit="submit"
    />
  </AdminPage>
</template>

<style scoped>
.admin-password-view {
  align-content: start;
}
</style>
