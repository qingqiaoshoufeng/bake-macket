import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_MINIAPP_PHONE_ROUTE_LENGTH,
  MAX_MINIAPP_WECHAT_LOGIN_ROUTE_LENGTH,
  createMiniappMessageHub,
  installMiniappBridge,
  requestMiniappPhoneCredential,
  requestMiniappProfileCompletion,
  requestMiniappWechatLogin,
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
  window.localStorage.clear();
  if (originalMiniProgram) setMiniProgram(originalMiniProgram);
  else Reflect.deleteProperty(window, 'wx');
  vi.restoreAllMocks();
});

describe('installMiniappBridge', () => {
  it('scrubs and rejects a WeChat code without a login state from this browser session', () => {
    window.history.replaceState(
      null,
      '',
      '/login?redirect=%2Forders&miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=%20code-1%20#form',
    );
    const onMessage = vi.fn();

    const teardown = installMiniappBridge(onMessage);

    expect(onMessage).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?redirect=%2Forders');
    expect(window.location.pathname).toBe('/login');
    expect(window.location.hash).toBe('#form');
    teardown();
  });

  it('emits a WeChat code only once when its state matches the pending browser login', async () => {
    const navigateTo = vi.fn((options: NavigateOptions) => options.success());
    setMiniProgram({ navigateTo });
    await requestMiniappWechatLogin(async () => true, {
      createState: () => 'state-1',
    });
    window.history.replaceState(
      null,
      '',
      '/login#miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=code-1&wechatState=state-1',
    );
    const onMessage = vi.fn();

    installMiniappBridge(onMessage);
    window.history.replaceState(
      null,
      '',
      '/login#miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=code-1&wechatState=state-1',
    );
    installMiniappBridge(onMessage);

    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith({
      source: 'bake-miniapp',
      type: 'WECHAT_CODE',
      code: 'code-1',
    });
    expect(window.location.search).toBe('');
  });

  it('rejects expired state and keeps a fresh state after an invalid code', async () => {
    const navigateTo = vi.fn((options: NavigateOptions) => options.success());
    setMiniProgram({ navigateTo });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await requestMiniappWechatLogin(async () => true, {
      createState: () => 'state-1',
    });

    window.history.replaceState(
      null,
      '',
      '/#miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=&wechatState=state-1',
    );
    const onMessage = vi.fn();
    installMiniappBridge(onMessage);
    expect(onMessage).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('bake_wechat_login_state')).toBe(
      'state-1',
    );

    now.mockReturnValue(1_000_000 + 10 * 60 * 1_000 + 1);
    window.history.replaceState(
      null,
      '',
      '/#miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=code-1&wechatState=state-1',
    );
    installMiniappBridge(onMessage);
    expect(onMessage).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('bake_wechat_login_state')).toBeNull();
  });

  it('parses the startup handoff when Object.hasOwn is unavailable', () => {
    const originalHasOwn = Object.hasOwn;
    Object.defineProperty(Object, 'hasOwn', {
      configurable: true,
      value: undefined,
    });
    window.history.replaceState(
      null,
      '',
      '/?miniappSource=bake-miniapp&miniappType=PHONE_CREDENTIAL&phoneCredential=legacy-webview-code',
    );
    const onMessage = vi.fn();

    try {
      const teardown = installMiniappBridge(onMessage);

      expect(onMessage).toHaveBeenCalledWith({
        source: 'bake-miniapp',
        type: 'PHONE_CREDENTIAL',
        credential: 'legacy-webview-code',
      });
      teardown();
    } finally {
      Object.defineProperty(Object, 'hasOwn', {
        configurable: true,
        value: originalHasOwn,
      });
    }
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

  it('never accepts a WeChat code from legacy query parameters', () => {
    window.localStorage.setItem('bake_wechat_login_state', 'state-1');
    window.localStorage.setItem(
      'bake_wechat_login_state_created_at',
      String(Date.now()),
    );
    window.history.replaceState(
      null,
      '',
      '/?miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=code-1&wechatState=state-1',
    );
    const onMessage = vi.fn();

    installMiniappBridge(onMessage);

    expect(onMessage).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

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

describe('profile completion handoff', () => {
  it.each(['PROFILE_UPDATED', 'PROFILE_SKIPPED'] as const)(
    'strictly parses and scrubs %s without profile payloads',
    (type) => {
      window.history.replaceState(
        null,
        '',
        `/profile?keep=1&miniappSource=bake-miniapp&miniappType=${type}`,
      );
      const onMessage = vi.fn();

      installMiniappBridge(onMessage);

      expect(onMessage).toHaveBeenCalledWith({ source: 'bake-miniapp', type });
      expect(window.location.search).toBe('?keep=1');
    },
  );

  it.each([
    'miniappSource=bake-miniapp&miniappType=PROFILE_UPDATED&wechatCode=secret',
    'miniappSource=bake-miniapp&miniappType=PROFILE_SKIPPED&phoneCredential=secret',
    'miniappSource=bake-miniapp&miniappType=PROFILE_UPDATED&miniappType=PROFILE_SKIPPED',
  ])(
    'rejects mixed or duplicate profile handoff and still scrubs it: %s',
    (query) => {
      window.history.replaceState(null, '', `/profile?keep=1&${query}`);
      const onMessage = vi.fn();

      installMiniappBridge(onMessage);

      expect(onMessage).not.toHaveBeenCalled();
      expect(window.location.search).toBe('?keep=1');
    },
  );

  it('opens the native profile page with only an encoded return URL', async () => {
    const navigateTo = vi.fn((options: NavigateOptions) => options.success());
    setMiniProgram({ navigateTo });
    window.history.replaceState(null, '', '/profile?tab=account');

    await expect(
      requestMiniappProfileCompletion(async () => true),
    ).resolves.toBe(true);
    expect(navigateTo).toHaveBeenCalledWith({
      url: `/pages/profile-completion/index?returnUrl=${encodeURIComponent(window.location.href)}`,
      success: expect.any(Function),
      fail: expect.any(Function),
    });
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

describe('requestMiniappWechatLogin', () => {
  it('等待 JSSDK 后以一次性 state 导航原生微信登录页', async () => {
    const navigateTo = vi.fn((options: NavigateOptions) => options.success());
    const ensureJssdk = vi.fn(async () => true);
    setMiniProgram({ navigateTo });
    window.history.replaceState(
      null,
      '',
      '/login?redirect=%2Fcheckout%3Ffrom%3Dcart#wechat',
    );

    await expect(
      requestMiniappWechatLogin(ensureJssdk, {
        createState: () => 'state-1',
      }),
    ).resolves.toBe(true);
    expect(navigateTo).toHaveBeenCalledWith({
      url: `/pages/wechat-login/index?returnUrl=${encodeURIComponent(window.location.href)}&state=state-1`,
      success: expect.any(Function),
      fail: expect.any(Function),
    });
    expect(window.localStorage.getItem('bake_wechat_login_state')).toBe(
      'state-1',
    );
  });

  it('导航失败时撤销 pending state，且缺少安全随机源时不导航', async () => {
    setMiniProgram({ navigateTo: (options) => options.fail() });
    await expect(
      requestMiniappWechatLogin(async () => true, {
        createState: () => 'state-1',
      }),
    ).resolves.toBe(false);
    expect(window.localStorage.getItem('bake_wechat_login_state')).toBeNull();

    const navigateTo = vi.fn();
    setMiniProgram({ navigateTo });
    await expect(
      requestMiniappWechatLogin(async () => true, {
        createState: () => {
          throw new Error('secure randomness unavailable');
        },
      }),
    ).resolves.toBe(false);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('显式登录取代等待 JSSDK 的自动尝试且只导航一次', async () => {
    const navigateTo = vi.fn((options: NavigateOptions) => options.success());
    setMiniProgram({ navigateTo });
    const releases: Array<(ready: boolean) => void> = [];
    const ensureJssdk = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          releases.push(resolve);
        }),
    );

    const automatic = requestMiniappWechatLogin(ensureJssdk, {
      automatic: true,
      createState: () => 'automatic-state',
    });
    const explicit = requestMiniappWechatLogin(ensureJssdk, {
      createState: () => 'explicit-state',
    });
    releases.forEach((release) => release(true));

    await expect(Promise.all([automatic, explicit])).resolves.toEqual([
      false,
      true,
    ]);
    expect(navigateTo).toHaveBeenCalledOnce();
    expect(navigateTo.mock.calls[0]?.[0].url).toContain('state=explicit-state');
    expect(window.localStorage.getItem('bake_wechat_login_state')).toBe(
      'explicit-state',
    );
  });

  it('JSSDK 缺失、返回失败或抛错时不导航', async () => {
    const navigateTo = vi.fn();
    setMiniProgram({ navigateTo });

    await expect(requestMiniappWechatLogin(async () => false)).resolves.toBe(
      false,
    );
    await expect(
      requestMiniappWechatLogin(async () => {
        throw new Error('JSSDK unavailable');
      }),
    ).resolves.toBe(false);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('navigateTo fail 或同步抛错时返回 false', async () => {
    setMiniProgram({ navigateTo: (options) => options.fail() });
    await expect(requestMiniappWechatLogin(async () => true)).resolves.toBe(
      false,
    );

    setMiniProgram({
      navigateTo: () => {
        throw new Error('bridge unavailable');
      },
    });
    await expect(requestMiniappWechatLogin(async () => true)).resolves.toBe(
      false,
    );
  });

  it('编码后路由过长时拒绝导航', async () => {
    const navigateTo = vi.fn();
    setMiniProgram({ navigateTo });
    window.history.replaceState(
      null,
      '',
      `/login?next=${'a'.repeat(MAX_MINIAPP_WECHAT_LOGIN_ROUTE_LENGTH)}`,
    );

    await expect(requestMiniappWechatLogin(async () => true)).resolves.toBe(
      false,
    );
    expect(navigateTo).not.toHaveBeenCalled();
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
