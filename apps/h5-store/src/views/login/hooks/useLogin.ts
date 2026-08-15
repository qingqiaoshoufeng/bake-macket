import { computed, ref } from 'vue';

import {
  DEVELOPMENT_LOGIN_HINT,
  makeWechatCodeMessage,
  miniappMessageHub,
} from '../../../bridge/miniapp.js';
import { useAuthStore } from '../../../stores/auth.js';
import { mapProfile } from '../../profile/hooks/useProfile.js';
import { loginFeatureApi } from '../api/index.js';
import { getDefaultDevelopmentLogin } from '../config/default-development-login.js';

export type LoginNotification =
  { type: 'success'; message: string } | { type: 'error'; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '登录失败,请稍后重试';
}

export function useLogin(
  isDevelopment: boolean,
  notify: (notification: LoginNotification) => void,
) {
  const auth = useAuthStore();
  const defaults = getDefaultDevelopmentLogin(isDevelopment);
  const phone = ref(defaults.phone);
  const code = ref(defaults.code);
  const submitting = ref(false);

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
      );
      auth.applySession(session, profile);
      notify({ type: 'success', message: '登录成功' });
      return true;
    } catch (error) {
      notify({ type: 'error', message: errorMessage(error) });
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
    miniappMessageHub.publish(makeWechatCodeMessage('dev-wechat-code'));
  }

  return {
    data: { phone, code },
    loading: computed(() => submitting.value),
    methods: { submit, prefill, testWechatCode },
  };
}
