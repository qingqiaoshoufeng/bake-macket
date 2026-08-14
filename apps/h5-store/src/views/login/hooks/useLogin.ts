import { computed, onMounted, onUnmounted, ref } from 'vue';

import {
  DEVELOPMENT_LOGIN_HINT,
  makeWechatCodeMessage,
  miniappMessageHub,
  requestMiniappPhoneCredential,
  type MiniappMessage,
} from '../../../bridge/miniapp.js';
import { useAuthStore } from '../../../stores/auth.js';
import { mapProfile } from '../../profile/hooks/useProfile.js';
import { loginFeatureApi } from '../api/index.js';
import { getDefaultDevelopmentLogin } from '../config/default-development-login.js';

export type LoginNotification =
  { type: 'success'; message: string } | { type: 'error'; message: string };

type BridgeCredential = Readonly<{
  key: string;
  run: () => Promise<void>;
}>;

type LoginGeneration = number;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '登录失败,请稍后重试';
}

function messageKey(message: MiniappMessage): string {
  return message.type === 'WECHAT_CODE'
    ? `LOGIN:${message.code}`
    : `PHONE:${message.credential}`;
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
  const miniprogramAttached = ref(false);
  const activeCredentials = new Set<string>();
  let loginGeneration: LoginGeneration = 0;
  let latestLoginRequest: Promise<void> = Promise.resolve();
  let phoneQueue: Promise<void> = Promise.resolve();

  function exchangeWechatCode(
    credential: string,
    generation: LoginGeneration,
  ): Promise<void> {
    const request = loginFeatureApi
      .loginWithWechatCode(credential)
      .then((session) => {
        if (generation !== loginGeneration) return;
        auth.applyCustomerSession(session);
        notify({ type: 'success', message: '微信登录成功' });
      });
    latestLoginRequest = request;
    return request;
  }

  async function exchangePhoneCredential(
    credential: string,
    generation: LoginGeneration,
    loginRequest: Promise<void>,
  ): Promise<void> {
    await loginRequest;
    if (generation !== loginGeneration) return;
    const session = await loginFeatureApi.bindWechatPhone(credential);
    if (generation !== loginGeneration) return;
    auth.applyCustomerSession(session);
    notify({ type: 'success', message: '手机号绑定成功' });
  }

  function buildBridgeCredential(message: MiniappMessage): BridgeCredential {
    const key = messageKey(message);
    if (message.type === 'WECHAT_CODE') {
      return {
        key,
        run: () => {
          loginGeneration += 1;
          return exchangeWechatCode(message.code, loginGeneration);
        },
      };
    }
    return {
      key,
      run: async () => {
        const generation = loginGeneration;
        const loginRequest = latestLoginRequest;
        const previous = phoneQueue.catch(() => undefined);
        phoneQueue = previous.then(() =>
          exchangePhoneCredential(message.credential, generation, loginRequest),
        );
        await phoneQueue;
      },
    };
  }

  async function consumeBridgeCredential(
    credential: BridgeCredential,
  ): Promise<void> {
    if (activeCredentials.has(credential.key)) return;
    activeCredentials.add(credential.key);
    submitting.value = true;
    try {
      await credential.run();
    } catch (error) {
      notify({ type: 'error', message: errorMessage(error) });
    } finally {
      activeCredentials.delete(credential.key);
      submitting.value = activeCredentials.size > 0;
    }
  }

  function onMiniappMessage(message: MiniappMessage): void {
    miniprogramAttached.value = true;
    const key = messageKey(message);
    if (activeCredentials.has(key)) return;
    void consumeBridgeCredential(buildBridgeCredential(message));
  }

  let unsubscribeMiniappHub: (() => void) | null = null;

  onMounted(() => {
    unsubscribeMiniappHub = miniappMessageHub.subscribe(onMiniappMessage);
  });
  onUnmounted(() => {
    unsubscribeMiniappHub?.();
    unsubscribeMiniappHub = null;
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
    loginGeneration += 1;
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

  async function requestPhoneCredential(): Promise<void> {
    const requested = await requestMiniappPhoneCredential();
    notify(
      requested
        ? { type: 'success', message: '请在微信授权页确认手机号' }
        : { type: 'error', message: '请在微信小程序中使用手机号授权' },
    );
  }

  return {
    data: { phone, code, miniprogramAttached },
    loading: computed(() => submitting.value),
    methods: { submit, prefill, testWechatCode, requestPhoneCredential },
  };
}
