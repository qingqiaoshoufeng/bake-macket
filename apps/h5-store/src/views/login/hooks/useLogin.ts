import { computed, onMounted, onUnmounted, ref } from 'vue';

import {
  DEVELOPMENT_LOGIN_HINT,
  installMiniappBridge,
  makeWechatCodeMessage,
  type MiniappMessage,
} from '../../../bridge/miniapp.js';
import { getDefaultDevelopmentLogin } from '../config/default-development-login.js';
import { useAuthStore } from '../../../stores/auth.js';
import { loginFeatureApi } from '../api/index.js';
import { mapProfile } from '../../profile/hooks/useProfile.js';

export type LoginNotification =
  { type: 'success'; message: string } | { type: 'error'; message: string };

export function useLogin(
  isDevelopment: boolean,
  notify: (notification: LoginNotification) => void,
) {
  const auth = useAuthStore();
  const defaults = getDefaultDevelopmentLogin(isDevelopment);
  const phone = ref(defaults.phone);
  const code = ref(defaults.code);
  const submitting = ref(false);
  const miniprogramAttached = ref(false);

  function onMiniappMessage(message: MiniappMessage): void {
    miniprogramAttached.value = true;
    if (message.type === 'WECHAT_CODE') {
      notify({
        type: 'success',
        message: `已收到小程序授权 code (${message.code.slice(0, 4)}…)`,
      });
      return;
    }
    notify({ type: 'success', message: '已收到小程序手机号凭证' });
  }

  let teardownMiniappBridge: (() => void) | null = null;

  onMounted(() => {
    teardownMiniappBridge = installMiniappBridge(onMiniappMessage);
  });
  onUnmounted(() => {
    teardownMiniappBridge?.();
    teardownMiniappBridge = null;
  });

  function validate(): string | null {
    return phone.value && code.value ? null : '请填写手机号与验证码';
  }

  async function submit(): Promise<boolean> {
    const validation = validate();
    if (validation) {
      notify({ type: 'error', message: validation });
      return false;
    }
    submitting.value = true;
    try {
      const normalizedPhone = phone.value.trim();
      const session = await loginFeatureApi.login(
        normalizedPhone,
        code.value.trim(),
      );
      const profile = mapProfile(
        await loginFeatureApi.getProfile(session.accessToken),
        true,
      );
      auth.applySession(session, profile);
      notify({ type: 'success', message: '登录成功' });
      return true;
    } catch (error) {
      notify({
        type: 'error',
        message: error instanceof Error ? error.message : '登录失败,请稍后重试',
      });
      return false;
    } finally {
      submitting.value = false;
    }
  }

  function prefill(): void {
    phone.value = DEVELOPMENT_LOGIN_HINT.phone;
    code.value = DEVELOPMENT_LOGIN_HINT.code;
  }

  function testWechatCode(): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: makeWechatCodeMessage('dev-wechat-code'),
      }),
    );
  }

  return {
    data: { phone, code, miniprogramAttached },
    loading: computed(() => submitting.value),
    methods: { submit, prefill, testWechatCode },
  };
}
