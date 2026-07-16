<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';

import { useAuthStore } from '../stores/auth.js';
import {
  DEVELOPMENT_LOGIN_HINT,
  installMiniappBridge,
  makeWechatCodeMessage,
  type MiniappMessage,
} from '../bridge/miniapp.js';
import { getDefaultDevelopmentLogin } from './login/config/default-development-login.js';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const defaultLogin = getDefaultDevelopmentLogin(import.meta.env.DEV);
const phone = ref(defaultLogin.phone);
const code = ref(defaultLogin.code);
const submitting = ref(false);

const isProduction = import.meta.env.PROD;
const showDevHint = computed(() => !isProduction);

const redirectTarget = computed(() => {
  const value = route.query.redirect;
  if (typeof value === 'string' && value.startsWith('/')) return value;
  return '/';
});

const miniprogramAttached = ref(false);

onMounted(() => {
  // Listen for WeChat login codes pushed by the native miniapp shell.
  // The H5 page only reacts to messages with `source === 'bake-miniapp'` so
  // other `postMessage` traffic on the page is ignored.
  installMiniappBridge((message: MiniappMessage) => {
    miniprogramAttached.value = true;
    if (message.type === 'WECHAT_CODE') {
      // Task 13 will wire the actual WeChat code exchange. For now we just
      // confirm to the user that the bridge is reachable.
      showToast({
        type: 'success',
        message: `已收到小程序授权 code (${message.code.slice(0, 4)}…)`,
      });
    } else if (message.type === 'PHONE_CREDENTIAL') {
      showToast({ type: 'success', message: '已收到小程序手机号凭证' });
    }
  });
});

async function onSubmit(): Promise<void> {
  if (!phone.value || !code.value) {
    showToast('请填写手机号与验证码');
    return;
  }
  submitting.value = true;
  try {
    await auth.loginWithDevelopmentCode(phone.value.trim(), code.value.trim());
    showToast({ type: 'success', message: '登录成功' });
    await router.replace(redirectTarget.value);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '登录失败,请稍后重试';
    showToast(message);
  } finally {
    submitting.value = false;
  }
}

function prefillDev(): void {
  phone.value = DEVELOPMENT_LOGIN_HINT.phone;
  code.value = DEVELOPMENT_LOGIN_HINT.code;
}

function testWechatCode(): void {
  // Dev-only helper to exercise the bridge handler without the miniapp shell.
  const fakeMessage = makeWechatCodeMessage('dev-wechat-code');
  window.dispatchEvent(new MessageEvent('message', { data: fakeMessage }));
}

defineExpose({ phone, code });
</script>

<template>
  <main class="login">
    <header class="login__hero">
      <h1>欢迎回到烘焙商城</h1>
      <p>使用手机号 + 验证码登录,完成下单前需先验证手机。</p>
    </header>

    <form class="login__form" @submit.prevent="onSubmit">
      <label class="field">
        <span>手机号</span>
        <input
          v-model="phone"
          inputmode="numeric"
          autocomplete="tel"
          placeholder="11 位手机号"
        />
      </label>
      <label class="field">
        <span>验证码</span>
        <input
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="6 位验证码"
        />
      </label>
      <button type="submit" class="login__submit" :disabled="submitting">
        {{ submitting ? '登录中…' : '登录' }}
      </button>
    </form>

    <section v-if="showDevHint" class="login__dev">
      <p>
        开发环境快捷登录:
        <button type="button" class="link" @click="prefillDev">
          填充 {{ DEVELOPMENT_LOGIN_HINT.phone }} /
          {{ DEVELOPMENT_LOGIN_HINT.code }}
        </button>
      </p>
      <p>
        模拟小程序消息:
        <button type="button" class="link" @click="testWechatCode">
          派发 WECHAT_CODE
        </button>
      </p>
      <p v-if="miniprogramAttached" class="login__dev-status">
        已监听来自小程序容器的消息。
      </p>
    </section>
  </main>
</template>

<style scoped>
.login {
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.login__hero h1 {
  color: var(--mall-leaf);
  margin: 0 0 6px;
  font-size: 22px;
}
.login__hero p {
  margin: 0;
  color: var(--mall-muted);
  font-size: 14px;
}
.login__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field span {
  color: var(--mall-muted);
  font-size: 12px;
}
.field input {
  height: 44px;
  border-radius: var(--van-radius-md);
  border: 1px solid #e7e2d8;
  padding: 0 12px;
  background: #fff;
  font-size: 15px;
  outline: none;
}
.field input:focus {
  border-color: var(--mall-leaf);
}
.login__submit {
  margin-top: 8px;
  height: 44px;
  border-radius: var(--van-radius-lg);
  border: 0;
  background: var(--van-primary-color);
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
}
.login__submit[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}
.login__dev {
  border-top: 1px dashed #d8d2c4;
  padding-top: 12px;
  color: var(--mall-muted);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.login__dev .link {
  border: 0;
  background: transparent;
  color: var(--mall-apricot);
  cursor: pointer;
  padding: 0;
  font-size: 12px;
}
.login__dev-status {
  color: var(--mall-leaf);
}
</style>
