import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_MINIAPP_PHONE_ROUTE_LENGTH,
  createMiniappMessageHub,
  installMiniappBridge,
  requestMiniappPhoneCredential,
  type MiniappMessage,
} from './miniapp.js';

const originalMiniProgram = window.wx?.miniProgram;

type NavigateOptions = Readonly<{
  url: string;
  success: () => void;
  fail: () => void;
}>;

function setMiniProgram(
  value: { navigateTo(options: NavigateOptions): void } | undefined,
): void {
  Object.defineProperty(window, 'wx', {
    configurable: true,
    value: value ? { miniProgram: value } : undefined,
  });
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  if (originalMiniProgram) setMiniProgram(originalMiniProgram);
  else Reflect.deleteProperty(window, 'wx');
  vi.restoreAllMocks();
});

describe('installMiniappBridge', () => {
  it('scrubs sensitive URL parameters before emitting a valid handoff', () => {
    window.history.replaceState(
      null,
      '',
      '/login?redirect=%2Forders&miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=%20code-1%20#form',
    );
    const onMessage = vi.fn(() => {
      expect(window.location.search).toBe('?redirect=%2Forders');
    });

    const teardown = installMiniappBridge(onMessage);

    expect(onMessage).toHaveBeenCalledWith({
      source: 'bake-miniapp',
      type: 'WECHAT_CODE',
      code: 'code-1',
    });
    expect(window.location.pathname).toBe('/login');
    expect(window.location.hash).toBe('#form');
    teardown();
  });

  it('has already scrubbed the URL when the business callback throws', () => {
    window.history.replaceState(
      null,
      '',
      '/login?keep=1&miniappSource=bake-miniapp&miniappType=PHONE_CREDENTIAL&phoneCredential=phone-1',
    );

    expect(() =>
      installMiniappBridge(() => {
        throw new Error('consumer failed');
      }),
    ).toThrow('consumer failed');
    expect(window.location.search).toBe('?keep=1');
  });

  it.each([
    'miniappSource=bake-miniapp&miniappType=PHONE_CREDENTIAL&wechatCode=wrong&phoneCredential=phone-1',
    'miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=code-1&phoneCredential=wrong',
    'miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=code-1&phoneCredential=',
    'miniappSource=bake-miniapp&miniappType=UNKNOWN&wechatCode=secret&phoneCredential=secret',
    'miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=%ZZ',
    'miniappSource=bake-miniapp&miniappSource=attacker&miniappType=WECHAT_CODE&wechatCode=code-1',
    'miniappType=WECHAT_CODE&miniappSource=bake-miniapp&miniappType=PHONE_CREDENTIAL&wechatCode=code-1',
    'miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=&wechatCode=code-1',
    'wechatCode=code-1&miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=code-2',
    'miniappSource=bake-miniapp&miniappType=PHONE_CREDENTIAL&phoneCredential=phone-1&phoneCredential=',
  ])(
    'rejects invalid handoff but scrubs every namespaced field: %s',
    (query) => {
      window.history.replaceState(null, '', `/login?keep=1&${query}`);
      const onMessage = vi.fn();

      const teardown = installMiniappBridge(onMessage);

      expect(onMessage).not.toHaveBeenCalled();
      expect(window.location.search).toBe('?keep=1');
      teardown();
    },
  );

  it('does not install a window message listener by default', () => {
    const onMessage = vi.fn();
    const teardown = installMiniappBridge(onMessage);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'bake-miniapp', type: 'WECHAT_CODE', code: 'code-2' },
        origin: window.location.origin,
        source: window,
      }),
    );

    expect(onMessage).not.toHaveBeenCalled();
    teardown();
  });

  it('accepts development window messages only from the same window and origin', () => {
    const received: MiniappMessage[] = [];
    const teardown = installMiniappBridge((message) => received.push(message), {
      enableWindowMessages: true,
    });
    const validData = {
      source: 'bake-miniapp',
      type: 'WECHAT_CODE',
      code: ' code-2 ',
    };

    window.dispatchEvent(
      new MessageEvent('message', {
        data: validData,
        origin: 'https://attacker.example',
        source: window,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: validData,
        origin: window.location.origin,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: validData,
        origin: window.location.origin,
        source: window,
      }),
    );

    expect(received).toEqual([
      { source: 'bake-miniapp', type: 'WECHAT_CODE', code: 'code-2' },
    ]);
    teardown();
  });
});

describe('miniapp message hub', () => {
  it('delivers a handoff published before the first subscriber exactly once', () => {
    const hub = createMiniappMessageHub();
    const message = {
      source: 'bake-miniapp',
      type: 'WECHAT_CODE',
      code: 'late-code',
    } as const;
    const first = vi.fn();
    const second = vi.fn();

    hub.publish(message);
    const unsubscribeFirst = hub.subscribe(first);
    const unsubscribeSecond = hub.subscribe(second);

    expect(first).toHaveBeenCalledWith(message);
    expect(second).not.toHaveBeenCalled();
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('publishes future handoffs to current subscribers and supports unsubscribe', () => {
    const hub = createMiniappMessageHub();
    const subscriber = vi.fn();
    const unsubscribe = hub.subscribe(subscriber);
    const message = {
      source: 'bake-miniapp',
      type: 'PHONE_CREDENTIAL',
      credential: 'phone-1',
    } as const;

    hub.publish(message);
    unsubscribe();
    hub.publish(message);

    expect(subscriber).toHaveBeenCalledOnce();
  });
});

describe('requestMiniappPhoneCredential', () => {
  it('awaits JSSDK readiness before navigating with an encoded return URL', async () => {
    const navigateTo = vi.fn((options: NavigateOptions) => options.success());
    const ensureJssdk = vi.fn(async () => true);
    setMiniProgram({ navigateTo });
    window.history.replaceState(
      null,
      '',
      '/login?redirect=%2Forders%3Ftab%3Dnew#phone',
    );

    await expect(requestMiniappPhoneCredential(ensureJssdk)).resolves.toBe(
      true,
    );
    expect(ensureJssdk).toHaveBeenCalledOnce();
    expect(navigateTo).toHaveBeenCalledWith({
      url: `/pages/phone-auth/index?returnUrl=${encodeURIComponent(window.location.href)}`,
      success: expect.any(Function),
      fail: expect.any(Function),
    });
  });

  it('resolves false without navigating when JSSDK loading fails', async () => {
    const navigateTo = vi.fn();
    setMiniProgram({ navigateTo });

    await expect(
      requestMiniappPhoneCredential(async () => false),
    ).resolves.toBe(false);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('resolves false on navigateTo failure or synchronous throw', async () => {
    setMiniProgram({ navigateTo: (options) => options.fail() });
    await expect(requestMiniappPhoneCredential(async () => true)).resolves.toBe(
      false,
    );

    setMiniProgram({
      navigateTo: () => {
        throw new Error('bridge unavailable');
      },
    });
    await expect(requestMiniappPhoneCredential(async () => true)).resolves.toBe(
      false,
    );
  });

  it('rejects an overlong miniapp route without calling navigateTo', async () => {
    const navigateTo = vi.fn();
    setMiniProgram({ navigateTo });
    window.history.replaceState(
      null,
      '',
      `/login?next=${'a'.repeat(MAX_MINIAPP_PHONE_ROUTE_LENGTH)}`,
    );

    await expect(requestMiniappPhoneCredential(async () => true)).resolves.toBe(
      false,
    );
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('resolves false outside a supported miniapp web-view', async () => {
    setMiniProgram(undefined);

    await expect(
      requestMiniappPhoneCredential(async () => false),
    ).resolves.toBe(false);
  });
});
