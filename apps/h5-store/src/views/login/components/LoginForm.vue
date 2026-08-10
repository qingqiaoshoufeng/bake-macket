<script setup lang="ts">
import { DEVELOPMENT_LOGIN_HINT } from '../../../bridge/miniapp.js';
import { LOGIN_COPY } from '../config/copy.js';

const props = defineProps<{
  phone: string;
  code: string;
  submitting: boolean;
  showDevHint: boolean;
  miniprogramAttached: boolean;
}>();
const emit = defineEmits<{
  (event: 'update:phone', value: string): void;
  (event: 'update:code', value: string): void;
  (event: 'submit'): void;
  (event: 'prefill'): void;
  (event: 'test-wechat'): void;
  (event: 'request-phone-credential'): void;
}>();
function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
</script>

<template>
  <div class="store-auth-page__canvas">
    <header class="login__hero">
      <p>{{ LOGIN_COPY.eyebrow }}</p>
      <h1>{{ LOGIN_COPY.title }}</h1>
      <span>{{ LOGIN_COPY.description }}</span>
    </header>
    <form class="login__form" @submit.prevent="emit('submit')">
      <label class="field"
        ><span>手机号</span
        ><input
          :value="props.phone"
          inputmode="numeric"
          autocomplete="tel"
          placeholder="11 位手机号"
          @input="emit('update:phone', inputValue($event))"
      /></label>
      <label class="field"
        ><span>验证码</span
        ><input
          :value="props.code"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="6 位验证码"
          @input="emit('update:code', inputValue($event))"
      /></label>
      <button
        type="submit"
        class="login__submit"
        :disabled="submitting"
        :aria-disabled="submitting"
      >
        {{ submitting ? '登录中…' : '登录' }}
      </button>
      <button
        type="button"
        class="login__miniapp-phone"
        data-testid="miniapp-phone-auth"
        @click="emit('request-phone-credential')"
      >
        使用微信手机号授权
      </button>
    </form>
    <section v-if="showDevHint" class="login__dev">
      <p class="login__dev-title">开发辅助</p>
      <p>
        开发环境快捷登录:
        <button type="button" class="link" @click="emit('prefill')">
          填充 {{ DEVELOPMENT_LOGIN_HINT.phone }} /
          {{ DEVELOPMENT_LOGIN_HINT.code }}
        </button>
      </p>
      <p>
        模拟小程序消息:
        <button type="button" class="link" @click="emit('test-wechat')">
          派发 WECHAT_CODE
        </button>
      </p>
      <p v-if="miniprogramAttached" class="login__dev-status">
        已监听来自小程序容器的消息。
      </p>
    </section>
  </div>
</template>

<style scoped>
.store-auth-page__canvas {
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-floating);
}
.login__hero {
  position: relative;
  padding: var(--mall-space-8) var(--mall-space-5) var(--mall-space-6);
  overflow: hidden;
  background: linear-gradient(135deg, var(--mall-surface-soft), #f8eee4);
}
.login__hero::after {
  position: absolute;
  right: -10px;
  bottom: -12px;
  color: rgb(255 255 255 / 68%);
  content: 'BAKE';
  font-size: 50px;
  font-weight: 800;
  letter-spacing: -0.08em;
  line-height: 1;
}
.login__hero p,
.login__hero h1,
.login__hero span {
  position: relative;
  z-index: 1;
}
.login__hero p {
  margin: 0 0 var(--mall-space-1);
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
}
.login__hero h1 {
  max-width: 320px;
  margin: 0;
  color: var(--mall-text);
  font-size: 27px;
  line-height: 1.3;
}
.login__hero span {
  display: block;
  max-width: 360px;
  margin-top: var(--mall-space-2);
  color: var(--mall-text-muted);
  font-size: 14px;
  line-height: 1.65;
}
.login__form {
  display: grid;
  gap: var(--mall-space-3);
  padding: var(--mall-space-5);
}
.field {
  display: grid;
  gap: var(--mall-space-1);
}
.field span {
  color: var(--mall-text-muted);
  font-size: 12px;
}
.field input {
  width: 100%;
  min-height: 46px;
  padding: 0 var(--mall-space-3);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-control);
  outline: none;
  background: var(--mall-canvas);
  color: var(--mall-text);
  font: inherit;
  font-size: 15px;
}
.field input:focus {
  border-color: var(--mall-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mall-primary) 14%, transparent);
}
.login__submit {
  min-height: 46px;
  margin-top: var(--mall-space-1);
  border: 0;
  border-radius: var(--mall-radius-card);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.login__submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.login__miniapp-phone {
  min-height: 44px;
  border: 1px solid var(--mall-primary);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.login__dev {
  display: grid;
  gap: var(--mall-space-2);
  margin: 0 var(--mall-space-5) var(--mall-space-5);
  padding: var(--mall-space-3);
  border: 1px dashed var(--mall-border);
  border-radius: var(--mall-radius-control);
  background: var(--mall-canvas);
  color: var(--mall-text-muted);
  font-size: 12px;
}
.login__dev p {
  margin: 0;
  line-height: 1.6;
}
.login__dev-title {
  color: var(--mall-text) !important;
  font-weight: 700;
}
.login__dev .link {
  min-height: 44px;
  padding: 0 var(--mall-space-1);
  border: 0;
  background: transparent;
  color: var(--mall-accent);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.login__dev-status {
  color: var(--mall-primary-strong);
}
</style>
