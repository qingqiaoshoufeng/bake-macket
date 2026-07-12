<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElButton, ElForm, ElFormItem, ElInput, ElMessage } from 'element-plus';

import { useAdminAuthStore } from '../stores/admin-auth.js';

const adminAuth = useAdminAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const submitting = ref(false);

const isProduction = import.meta.env.PROD;
const showDevHint = computed(() => !isProduction);

const redirectTarget = computed(() => {
  const value = route.query.redirect;
  if (typeof value === 'string' && value.startsWith('/')) return value;
  return '/dashboard';
});

async function onSubmit(): Promise<void> {
  if (!email.value || !password.value) {
    ElMessage.warning('请输入管理员邮箱与密码');
    return;
  }
  submitting.value = true;
  try {
    await adminAuth.loginAsAdmin(email.value.trim(), password.value);
    ElMessage.success('登录成功');
    await router.replace(redirectTarget.value);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '登录失败,请稍后重试';
    ElMessage.error(message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="admin-login">
    <section class="admin-login__card">
      <header class="admin-login__header">
        <span class="admin-login__brand-mark">烘</span>
        <h1>烘焙商城 · 商家后台</h1>
        <p>请使用商家管理员账号登录。</p>
      </header>

      <ElForm class="admin-login__form" @submit.prevent="onSubmit">
        <ElFormItem label="管理员邮箱">
          <ElInput
            v-model="email"
            type="email"
            autocomplete="username"
            placeholder="admin@example.com"
            data-testid="admin-email"
          />
        </ElFormItem>
        <ElFormItem label="登录密码">
          <ElInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            show-password
            placeholder="请输入登录密码"
            data-testid="admin-password"
          />
        </ElFormItem>
        <ElButton
          type="primary"
          native-type="submit"
          :loading="submitting"
          class="admin-login__submit"
          data-testid="admin-submit"
        >
          {{ submitting ? '登录中…' : '登 录' }}
        </ElButton>
      </ElForm>

      <section
        v-if="showDevHint"
        class="admin-login__dev"
        data-testid="admin-dev-hint"
      >
        <strong>开发环境提示</strong>
        <p>
          管理员登录由 <code>POST /api/v1/admin/auth/login</code> API 驱动,
          没有前端预置的超级管理员账号 —— 请在 <code>.env</code> 中配置
          <code>BOOTSTRAP_ADMIN_EMAIL</code> /
          <code>BOOTSTRAP_ADMIN_PASSWORD</code> 后再启动 NestJS 后端。
        </p>
      </section>
    </section>

    <aside class="admin-login__illustration" aria-hidden="true">
      <div class="admin-login__bubble admin-login__bubble--lilac"></div>
      <div class="admin-login__bubble admin-login__bubble--pink"></div>
      <p>轻 二次元 · 紫罗兰&粉色点缀</p>
    </aside>
  </main>
</template>

<style scoped>
.admin-login {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 100vh;
  background: #f6f4fb;
}

.admin-login__card {
  background: #fff;
  margin: 64px;
  border-radius: 16px;
  padding: 40px 36px;
  box-shadow: 0 12px 40px rgba(123, 97, 200, 0.1);
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.admin-login__header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.admin-login__brand-mark {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--el-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 18px;
}

.admin-login__header h1 {
  margin: 8px 0 0;
  font-size: 22px;
  color: #2f2a3d;
}

.admin-login__header p {
  margin: 0;
  color: #8a83a3;
  font-size: 14px;
}

.admin-login__form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.admin-login__submit {
  margin-top: 8px;
  height: 40px;
  border-radius: var(--el-border-radius-base);
  font-weight: 500;
}

.admin-login__dev {
  background: #fff5fa;
  border: 1px dashed var(--admin-pink);
  border-radius: 10px;
  padding: 12px 14px;
  color: #6f5d80;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.admin-login__dev strong {
  color: var(--admin-pink);
}

.admin-login__dev code {
  background: #fff;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  color: #5b3f70;
}

.admin-login__illustration {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5f5980;
  font-size: 13px;
  letter-spacing: 1px;
  overflow: hidden;
}

.admin-login__bubble {
  position: absolute;
  border-radius: 50%;
  filter: blur(0px);
  opacity: 0.85;
}

.admin-login__bubble--lilac {
  width: 320px;
  height: 320px;
  background: var(--admin-lilac);
  top: 20%;
  left: 20%;
}

.admin-login__bubble--pink {
  width: 220px;
  height: 220px;
  background: #ffe1ec;
  bottom: 18%;
  right: 18%;
}

@media (max-width: 960px) {
  .admin-login {
    grid-template-columns: 1fr;
  }
  .admin-login__card {
    margin: 24px;
  }
  .admin-login__illustration {
    display: none;
  }
}
</style>
