<script setup lang="ts">
import { ElButton, ElForm, ElFormItem, ElInput } from 'element-plus';

import type { AdminPasswordForm, AdminPasswordMode } from '../type/index.js';

const props = defineProps<{
  readonly form: AdminPasswordForm;
  readonly mode: AdminPasswordMode;
  readonly submitting: boolean;
}>();

const emit = defineEmits<{
  'update:form': [form: AdminPasswordForm];
  submit: [];
}>();

function updateForm(patch: Partial<AdminPasswordForm>): void {
  emit('update:form', { ...props.form, ...patch });
}
</script>

<template>
  <section class="admin-password-card">
    <div class="admin-password-card__intro">
      <span class="admin-password-card__mark" aria-hidden="true">钥</span>
      <div>
        <h2>{{ mode === 'initial' ? '设置你的正式密码' : '更新登录密码' }}</h2>
        <p>
          {{
            mode === 'initial'
              ? '临时密码仅用于首次进入，请立即替换后继续处理店务。'
              : '定期更新密码，帮助保护后台账号与经营数据。'
          }}
        </p>
      </div>
    </div>

    <ElForm class="admin-password-card__form" @submit.prevent="emit('submit')">
      <ElFormItem :label="mode === 'initial' ? '临时密码' : '当前密码'">
        <ElInput
          :model-value="form.currentPassword"
          type="password"
          autocomplete="current-password"
          show-password
          :placeholder="
            mode === 'initial' ? '请输入临时密码' : '请输入当前密码'
          "
          data-testid="admin-current-password"
          @update:model-value="updateForm({ currentPassword: $event })"
        />
      </ElFormItem>
      <ElFormItem label="新密码">
        <ElInput
          :model-value="form.newPassword"
          type="password"
          autocomplete="new-password"
          show-password
          placeholder="请输入新密码"
          data-testid="admin-new-password"
          @update:model-value="updateForm({ newPassword: $event })"
        />
      </ElFormItem>
      <ElFormItem label="确认新密码">
        <ElInput
          :model-value="form.confirmPassword"
          type="password"
          autocomplete="new-password"
          show-password
          placeholder="请再次输入新密码"
          data-testid="admin-confirm-password"
          @update:model-value="updateForm({ confirmPassword: $event })"
        />
      </ElFormItem>
      <ElButton
        type="primary"
        native-type="submit"
        :loading="submitting"
        class="admin-password-card__submit"
        data-testid="admin-password-submit"
      >
        {{ submitting ? '保存中…' : '保存新密码' }}
      </ElButton>
    </ElForm>
  </section>
</template>

<style scoped>
.admin-password-card {
  display: grid;
  gap: 26px;
  width: min(100%, 620px);
  padding: clamp(26px, 4vw, 42px);
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: 24px;
  box-shadow: 0 20px 60px rgb(73 57 105 / 10%);
}

.admin-password-card__intro {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.admin-password-card__mark {
  display: grid;
  flex: none;
  width: 48px;
  height: 48px;
  place-items: center;
  background: var(--admin-surface-soft);
  border: 1px solid color-mix(in srgb, var(--admin-primary) 24%, white);
  border-radius: 15px;
  color: var(--admin-primary);
  font-size: 18px;
  font-weight: 800;
}

.admin-password-card h2 {
  margin: 0;
  color: var(--admin-text);
  font-size: 21px;
}

.admin-password-card p {
  margin: 8px 0 0;
  color: var(--admin-muted);
  font-size: 14px;
  line-height: 1.7;
}

.admin-password-card__form {
  display: grid;
  gap: 5px;
}

.admin-password-card__submit {
  width: 100%;
  height: 44px;
  margin-top: 4px;
  border-radius: 12px;
  font-weight: 700;
}
</style>
