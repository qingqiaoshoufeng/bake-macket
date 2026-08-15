import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import type { CustomerAuthSessionView } from '@bake-mall/contracts';

import {
  createMiniappMessageHub,
  type MiniappMessageHub,
} from '../../../bridge/miniapp.js';
import {
  createWechatAuthCoordinator,
  type WechatAuthStatus,
} from './createWechatAuthCoordinator.js';

const anonymousSession = {
  accessToken: 'wechat-user-token',
  expiresAt: '2026-08-14T15:00:00.000Z',
  profile: {
    id: 'user-1',
    nickname: '微信顾客',
    avatarUrl: undefined,
    phone: undefined,
    phoneVerified: false,
    orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
  },
} satisfies CustomerAuthSessionView;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createSubject(
  hub: MiniappMessageHub = createMiniappMessageHub(),
  exchange: (code: string) => Promise<CustomerAuthSessionView> = vi.fn(() =>
    Promise.resolve(anonymousSession),
  ),
) {
  const applySession = vi.fn();
  const state = {
    error: ref<string | null>(null),
    status: ref<WechatAuthStatus>('idle'),
  };
  const coordinator = createWechatAuthCoordinator({
    applySession,
    exchangeWechatCode: exchange,
    hub,
    state,
  });
  return { applySession, coordinator, exchange, hub, state };
}

describe('createWechatAuthCoordinator', () => {
  it('在页面组件未挂载时也会兑换 WECHAT_CODE 并应用未绑定手机号的 session', async () => {
    const { applySession, coordinator, exchange, hub } = createSubject();
    coordinator.start();

    hub.publish({
      source: 'bake-miniapp',
      type: 'WECHAT_CODE',
      code: 'wechat-code-1',
    });
    await coordinator.waitForCurrentAttempt();

    expect(exchange).toHaveBeenCalledOnce();
    expect(exchange).toHaveBeenCalledWith('wechat-code-1');
    expect(applySession).toHaveBeenCalledWith(anonymousSession);
  });

  it('忽略顾客 PHONE_CREDENTIAL，且重复 start 不会建立重复订阅', async () => {
    const subscribe = vi.fn(createMiniappMessageHub().subscribe);
    const hub = { publish: vi.fn(), subscribe } satisfies MiniappMessageHub;
    const { coordinator, exchange } = createSubject(hub);

    coordinator.start();
    coordinator.start();
    const subscriber = subscribe.mock.calls[0]?.[0];
    subscriber?.({
      source: 'bake-miniapp',
      type: 'PHONE_CREDENTIAL',
      credential: 'phone-code',
    });
    await coordinator.waitForCurrentAttempt();

    expect(subscribe).toHaveBeenCalledOnce();
    expect(exchange).not.toHaveBeenCalled();
  });

  it('对重复的活跃 code 只发起一次请求', async () => {
    const pending = deferred<CustomerAuthSessionView>();
    const exchange = vi.fn(() => pending.promise);
    const { coordinator, hub } = createSubject(undefined, exchange);
    coordinator.start();
    const message = {
      source: 'bake-miniapp',
      type: 'WECHAT_CODE',
      code: 'duplicate-code',
    } as const;

    hub.publish(message);
    hub.publish(message);
    expect(exchange).toHaveBeenCalledTimes(1);

    pending.resolve(anonymousSession);
    await coordinator.waitForCurrentAttempt();
  });

  it('较早请求晚返回时不能覆盖较新的 session', async () => {
    const first = deferred<CustomerAuthSessionView>();
    const newerSession = {
      ...anonymousSession,
      accessToken: 'newer-token',
      profile: { ...anonymousSession.profile, id: 'user-2' },
    };
    const exchange = vi
      .fn<(code: string) => Promise<CustomerAuthSessionView>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(newerSession);
    const { applySession, coordinator, hub } = createSubject(
      undefined,
      exchange,
    );
    coordinator.start();

    hub.publish({ source: 'bake-miniapp', type: 'WECHAT_CODE', code: 'first' });
    hub.publish({
      source: 'bake-miniapp',
      type: 'WECHAT_CODE',
      code: 'second',
    });
    await coordinator.waitForCurrentAttempt();
    first.resolve(anonymousSession);
    await first.promise;
    await Promise.resolve();

    expect(applySession).toHaveBeenCalledTimes(1);
    expect(applySession).toHaveBeenCalledWith(newerSession);
  });

  it('兑换失败后仍能处理新的 code，等待方法不向路由抛错', async () => {
    const exchange = vi
      .fn<(code: string) => Promise<CustomerAuthSessionView>>()
      .mockRejectedValueOnce(new Error('微信暂不可用'))
      .mockResolvedValueOnce(anonymousSession);
    const { applySession, coordinator, hub } = createSubject(
      undefined,
      exchange,
    );
    coordinator.start();

    hub.publish({ source: 'bake-miniapp', type: 'WECHAT_CODE', code: 'bad' });
    await expect(coordinator.waitForCurrentAttempt()).resolves.toBeUndefined();
    hub.publish({ source: 'bake-miniapp', type: 'WECHAT_CODE', code: 'fresh' });
    await coordinator.waitForCurrentAttempt();

    expect(exchange).toHaveBeenCalledTimes(2);
    expect(applySession).toHaveBeenCalledWith(anonymousSession);
  });

  it('当前兑换失败时暴露可恢复的失败状态', async () => {
    const exchange = vi.fn(() => Promise.reject(new Error('invalid code')));
    const { coordinator, hub, state } = createSubject(undefined, exchange);
    coordinator.start();

    hub.publish({ source: 'bake-miniapp', type: 'WECHAT_CODE', code: 'bad' });
    await coordinator.waitForCurrentAttempt();

    expect(state.status.value).toBe('failed');
    expect(state.error.value).toContain('重新进入小程序');
  });
});
