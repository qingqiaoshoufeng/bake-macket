<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
} from 'element-plus';

import type {
  PrinterChallengeState,
  PrinterVerificationChallengeView,
  VerifyPrinterForm,
} from '../type/index.js';

const props = defineProps<{
  readonly visible: boolean;
  readonly form: VerifyPrinterForm;
  readonly challenge: PrinterVerificationChallengeView | null;
  readonly challengeState?: PrinterChallengeState;
  readonly allowManualRetry?: boolean;
  readonly countdownSeconds: number;
  readonly submitting: boolean;
}>();
const emit = defineEmits<{
  close: [];
  'update:form': [form: VerifyPrinterForm];
  submit: [];
  recovery: [];
}>();

function updateForm(patch: Partial<VerifyPrinterForm>): void {
  emit('update:form', { ...props.form, ...patch });
}

function countdownLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
</script>

<template>
  <ElDialog
    :model-value="visible"
    title="确认纸面验证码"
    width="min(92vw, 500px)"
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    @close="emit('close')"
  >
    <div v-if="challenge" class="verify-printer__status">
      <strong v-if="countdownSeconds > 0">
        有效期 {{ countdownLabel(countdownSeconds) }}
      </strong>
      <strong v-else>验证码已过期</strong>
      <span>剩余 {{ challenge.remainingAttempts }} 次尝试</span>
    </div>
    <ElAlert
      v-if="challengeState === 'metadata-missing'"
      title="验证码信息缺失，请刷新列表或重发验证码。"
      type="warning"
      :closable="false"
      show-icon
    />
    <ElAlert
      v-else-if="challenge && countdownSeconds === 0"
      title="验证码已过期，请重发验证码或进入恢复流程。"
      type="warning"
      :closable="false"
      show-icon
    />
    <ElForm label-position="top" @submit.prevent="emit('submit')">
      <ElFormItem label="纸面验证码">
        <ElInput
          :model-value="form.code"
          inputmode="numeric"
          maxlength="6"
          autocomplete="one-time-code"
          @update:model-value="updateForm({ code: String($event) })"
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
      <ElButton :disabled="submitting" @click="emit('close')">关闭</ElButton>
      <ElButton
        v-if="challengeState === 'metadata-missing'"
        type="warning"
        plain
        data-testid="verify-expired-recovery"
        @click="emit('recovery')"
      >
        刷新 / 重发
      </ElButton>
      <ElButton
        v-else-if="
          challengeState === 'expired' || (challenge && countdownSeconds === 0)
        "
        type="warning"
        plain
        data-testid="verify-expired-recovery"
        @click="emit('recovery')"
      >
        重发 / 恢复
      </ElButton>
      <ElButton
        v-else
        type="primary"
        :loading="submitting"
        :data-testid="allowManualRetry ? 'verify-manual-retry' : undefined"
        @click="emit('submit')"
      >
        {{ allowManualRetry ? '继续原验证' : '确认验证码' }}
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.verify-printer__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -4px 0 16px;
  padding: 13px 15px;
  border: 1px solid var(--admin-border);
  border-radius: 12px;
  background: var(--admin-surface-soft);
  color: var(--admin-muted);
  font-size: 13px;
}

.verify-printer__status strong {
  color: var(--admin-primary);
}
</style>
