<script setup lang="ts">
import { ElButton, ElForm, ElFormItem, ElInput } from 'element-plus';

import type { AdminLoginKind } from '../type/index.js';

withDefaults(
  defineProps<{
    readonly kind: AdminLoginKind;
    readonly email: string;
    readonly phone: string;
    readonly password: string;
    readonly submitting: boolean;
    readonly showDevHint?: boolean;
  }>(),
  { showDevHint: false },
);

const emit = defineEmits<{
  'update:email': [value: string];
  'update:phone': [value: string];
  'update:password': [value: string];
  'select-kind': [value: AdminLoginKind];
  submit: [];
}>();
</script>

<template>
  <section class="admin-login-card">
    <header class="admin-login-card__header">
      <span class="admin-login-card__brand-mark" aria-hidden="true">烘</span>
      <div>
        <p class="admin-login-card__eyebrow">BAKE MALL · ADMIN</p>
        <h1>店长小助手</h1>
        <p class="admin-login-card__description">
          登录商家后台，继续打理今日烘焙与订单。
        </p>
      </div>
    </header>

    <div class="admin-login-card__kinds" aria-label="登录身份">
      <ElButton
        :type="kind === 'SUPER_ADMIN' ? 'primary' : 'default'"
        :plain="kind !== 'SUPER_ADMIN'"
        data-testid="admin-login-kind-super-admin"
        @click="emit('select-kind', 'SUPER_ADMIN')"
      >
        超级管理员
      </ElButton>
      <ElButton
        :type="kind === 'OPERATOR' ? 'primary' : 'default'"
        :plain="kind !== 'OPERATOR'"
        data-testid="admin-login-kind-operator"
        @click="emit('select-kind', 'OPERATOR')"
      >
        操作员
      </ElButton>
    </div>

    <ElForm class="admin-login-card__form" @submit.prevent="emit('submit')">
      <ElFormItem v-if="kind === 'SUPER_ADMIN'" label="管理员邮箱">
        <ElInput
          :model-value="email"
          type="email"
          autocomplete="username"
          placeholder="请输入管理员邮箱"
          data-testid="admin-email"
          @update:model-value="emit('update:email', $event)"
        />
      </ElFormItem>
      <ElFormItem v-else label="操作员手机号">
        <ElInput
          :model-value="phone"
          type="tel"
          inputmode="numeric"
          autocomplete="username"
          placeholder="请输入操作员手机号"
          data-testid="admin-phone"
          @update:model-value="emit('update:phone', $event)"
        />
      </ElFormItem>
      <ElFormItem label="登录密码">
        <ElInput
          :model-value="password"
          type="password"
          autocomplete="current-password"
          show-password
          placeholder="请输入登录密码"
          data-testid="admin-login-password"
          @update:model-value="emit('update:password', $event)"
        />
      </ElFormItem>
      <ElButton
        type="primary"
        native-type="submit"
        :loading="submitting"
        class="admin-login-card__submit"
        data-testid="admin-submit"
      >
        {{ submitting ? '登录中…' : '登录店长后台' }}
      </ElButton>
    </ElForm>

    <section
      v-if="showDevHint"
      class="admin-login-card__dev"
      data-testid="admin-dev-hint"
    >
      <strong>开发环境提示</strong>
      <p>
        管理员登录由 <code>POST /api/v1/admin/auth/login</code> API 驱动。
        后端请配置 <code>ADMIN_EMAIL</code> / <code>ADMIN_PASSWORD</code>，
        本地表单预填请配置 <code>VITE_ADMIN_EMAIL</code> /
        <code>VITE_ADMIN_PASSWORD</code>。
      </p>
    </section>
  </section>
</template>

<style scoped>
.admin-login-card {
  display: grid;
  align-content: center;
  gap: 26px;
  width: min(100%, 520px);
  min-height: min(680px, calc(100vh - 96px));
  padding: clamp(30px, 5vw, 54px);
  background: color-mix(in srgb, var(--admin-surface) 96%, transparent);
  border: 1px solid color-mix(in srgb, var(--admin-border) 84%, transparent);
  border-radius: 28px;
  box-shadow: 0 24px 70px rgb(73 57 105 / 12%);
}

.admin-login-card__header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.admin-login-card__brand-mark {
  display: grid;
  flex: none;
  width: 52px;
  height: 52px;
  place-items: center;
  background: linear-gradient(145deg, var(--admin-primary), #9886cf);
  border: 4px solid #f4f0ff;
  border-radius: 17px;
  color: #fff;
  font-size: 20px;
  font-weight: 800;
  box-shadow: 0 10px 24px rgb(121 101 184 / 24%);
  transform: rotate(-3deg);
}

.admin-login-card__eyebrow {
  margin: 0 0 7px;
  color: var(--admin-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.admin-login-card h1 {
  margin: 0;
  color: var(--admin-text);
  font-size: clamp(27px, 3vw, 34px);
  line-height: 1.2;
  letter-spacing: -0.03em;
}

.admin-login-card__description {
  margin: 9px 0 0;
  color: var(--admin-muted);
  font-size: 14px;
  line-height: 1.7;
}

.admin-login-card__kinds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 5px;
  background: var(--admin-surface-soft);
  border-radius: 15px;
}

.admin-login-card__kinds :deep(.el-button) {
  width: 100%;
  margin: 0;
  border-radius: 11px;
}

.admin-login-card__form {
  display: grid;
  gap: 6px;
}

.admin-login-card__submit {
  width: 100%;
  height: 46px;
  margin-top: 4px;
  border-radius: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.admin-login-card__dev {
  padding: 13px 15px;
  background: #fcf5f8;
  border: 1px dashed color-mix(in srgb, var(--admin-pink) 55%, white);
  border-radius: var(--admin-radius-control);
  color: #716477;
  font-size: 12px;
  line-height: 1.7;
}

.admin-login-card__dev strong {
  color: #a84f72;
}

.admin-login-card__dev p {
  margin: 4px 0 0;
}

.admin-login-card__dev code {
  padding: 1px 5px;
  background: #fff;
  border-radius: 4px;
  color: #694f79;
  font-size: 11px;
}

@media (max-width: 640px) {
  .admin-login-card {
    min-height: auto;
    padding: 28px 22px;
    border-radius: 22px;
  }

  .admin-login-card__header {
    gap: 13px;
  }
}
</style>
