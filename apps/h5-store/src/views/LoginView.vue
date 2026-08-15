<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';

import StorePage from '../components/layout/StorePage.vue';
import { requestMiniappWechatLogin } from '../bridge/miniapp.js';
import { useAuthStore } from '../stores/auth.js';
import {
  LoginForm,
  useLogin,
  wechatAuthState,
  type LoginNotification,
} from './login/index.js';
import { resolveSafeInternalRedirect } from '../utils/redirect.js';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

function notify(notification: LoginNotification): void {
  showToast(
    notification.type === 'success'
      ? { type: 'success', message: notification.message }
      : notification.message,
  );
}

const isDevelopment = import.meta.env.DEV;
const login = useLogin(isDevelopment, notify);
const redirectTarget = computed(() =>
  resolveSafeInternalRedirect(route.query.redirect),
);

watch(
  () => auth.isAuthenticated,
  (authenticated) => {
    if (authenticated) void router.replace(redirectTarget.value);
  },
  { immediate: true },
);

async function submit(): Promise<void> {
  if (await login.methods.submit()) await router.replace(redirectTarget.value);
}

async function requestWechatLogin(): Promise<void> {
  if (await requestMiniappWechatLogin()) return;
  showToast('请在微信小程序中打开后使用微信登录');
}

defineExpose({ phone: login.data.phone, code: login.data.code });
</script>

<template>
  <StorePage class="login store-auth-page">
    <LoginForm
      v-model:phone="login.data.phone.value"
      v-model:code="login.data.code.value"
      :submitting="login.loading.value"
      :show-dev-hint="isDevelopment"
      :wechat-status="wechatAuthState.status.value"
      :wechat-error="wechatAuthState.error.value"
      @submit="submit"
      @wechat-login="requestWechatLogin"
      @prefill="login.methods.prefill"
      @test-wechat="login.methods.testWechatCode"
    />
  </StorePage>
</template>

<style scoped>
.store-auth-page {
  display: grid;
  min-height: 100%;
  place-items: center;
}
</style>
