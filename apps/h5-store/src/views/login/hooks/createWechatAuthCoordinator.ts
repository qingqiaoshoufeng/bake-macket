import { readonly, ref, type DeepReadonly, type Ref } from 'vue';

import type { CustomerAuthSessionView } from '@bake-mall/contracts';

import type {
  MiniappMessage,
  MiniappMessageHub,
} from '../../../bridge/miniapp.js';

export type WechatAuthStatus =
  'authenticated' | 'exchanging' | 'failed' | 'idle';

type MutableWechatAuthState = Readonly<{
  error: Ref<string | null>;
  status: Ref<WechatAuthStatus>;
}>;

export type WechatAuthState = DeepReadonly<MutableWechatAuthState>;

const mutableWechatAuthState: MutableWechatAuthState = {
  error: ref(null),
  status: ref('idle'),
};

export const wechatAuthState: WechatAuthState = {
  error: readonly(mutableWechatAuthState.error),
  status: readonly(mutableWechatAuthState.status),
};

export type WechatAuthCoordinator = Readonly<{
  start: () => void;
  stop: () => void;
  waitForCurrentAttempt: () => Promise<void>;
}>;

type WechatAuthCoordinatorDependencies = Readonly<{
  applySession: (session: CustomerAuthSessionView) => void;
  exchangeWechatCode: (code: string) => Promise<CustomerAuthSessionView>;
  hub: MiniappMessageHub;
  state?: MutableWechatAuthState;
}>;

export function createWechatAuthCoordinator(
  dependencies: WechatAuthCoordinatorDependencies,
): WechatAuthCoordinator {
  const activeCodes = new Set<string>();
  const state = dependencies.state ?? mutableWechatAuthState;
  let generation = 0;
  let unsubscribe: (() => void) | null = null;
  let currentAttempt: Promise<void> = Promise.resolve();

  function exchange(code: string): void {
    if (activeCodes.has(code)) return;
    activeCodes.add(code);
    generation += 1;
    const requestGeneration = generation;
    state.status.value = 'exchanging';
    state.error.value = null;
    currentAttempt = dependencies
      .exchangeWechatCode(code)
      .then((session) => {
        if (requestGeneration !== generation) return;
        dependencies.applySession(session);
        state.status.value = 'authenticated';
      })
      .catch(() => {
        if (requestGeneration !== generation) return;
        state.status.value = 'failed';
        state.error.value = '微信登录失败，请关闭当前页面后重新进入小程序';
      })
      .finally(() => {
        activeCodes.delete(code);
      });
  }

  function consume(message: MiniappMessage): void {
    if (message.type === 'WECHAT_CODE') exchange(message.code);
  }

  function start(): void {
    if (unsubscribe) return;
    unsubscribe = dependencies.hub.subscribe(consume);
  }

  function stop(): void {
    if (!unsubscribe) return;
    unsubscribe();
    unsubscribe = null;
  }

  function waitForCurrentAttempt(): Promise<void> {
    return currentAttempt;
  }

  return { start, stop, waitForCurrentAttempt };
}
