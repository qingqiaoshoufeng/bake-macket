<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';

import StorePage from '../components/layout/StorePage.vue';
import { LoginForm, useLogin, type LoginNotification } from './login/index.js';

const router = useRouter();
const route = useRoute();

function notify(notification: LoginNotification): void {
  showToast(
    notification.type === 'success'
      ? { type: 'success', message: notification.message }
      : notification.message,
  );
}

const isDevelopment = import.meta.env.DEV;
const login = useLogin(isDevelopment, notify);
const redirectTarget = computed(() => {
  const value = route.query.redirect;
  return typeof value === 'string' && value.startsWith('/') ? value : '/';
});

async function submit(): Promise<void> {
  if (await login.methods.submit()) await router.replace(redirectTarget.value);
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
      :miniprogram-attached="login.data.miniprogramAttached.value"
      @submit="submit"
      @prefill="login.methods.prefill"
      @test-wechat="login.methods.testWechatCode"
      @request-phone-credential="login.methods.requestPhoneCredential"
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
