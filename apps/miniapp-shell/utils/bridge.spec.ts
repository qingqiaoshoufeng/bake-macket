import { execFile } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMiniappConfigSource,
  requireHttpsH5Url,
  resolveBuildH5Url,
} from '../scripts/config.mjs';
import {
  buildLoginHandoffUrl,
  buildPhoneCredentialHandoffUrl,
  buildProfileHandoffUrl,
  createIndexPageController,
  createPhoneAuthController,
  createPhoneCredentialHandoffStore,
  createProfileHandoffStore,
  createWechatLoginController,
  createWechatLoginHandoffStore,
  decodeRouteParameter,
  parseLoginCode,
  parsePhoneCredential,
  resolvePhoneAuthReturnUrl,
  resolveWechatLoginReturnUrl,
  validateReturnUrl,
} from './bridge.js';

const rootBaseUrl = 'https://mall.example.com/';
const rootOrigin = 'https://mall.example.com';
const execFileAsync = promisify(execFile);

function successfulRebuild(url: string, deliveryId: string): boolean {
  return typeof url === 'string' && typeof deliveryId === 'string';
}

function createSuccessfulRebuild() {
  return vi.fn(successfulRebuild);
}

describe('miniapp URL handoff', () => {
  it('loads H5 with an encoded one-time login code while preserving query and hash', () => {
    expect(
      buildLoginHandoffUrl(
        'https://MALL.example.com:443/?campaign=summer#hero',
        ' login code&next ',
        ' state-1 ',
      ),
    ).toBe(
      'https://mall.example.com/?campaign=summer#hero&miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=login%20code%26next&wechatState=state-1',
    );
  });

  it.each([undefined, null, '', '   ', 42])(
    'rejects an empty or invalid login code %#',
    (code) => {
      expect(parseLoginCode(code)).toBeNull();
      expect(() => buildLoginHandoffUrl(rootBaseUrl, code, 'state-1')).toThrow(
        'login code must not be empty',
      );
    },
  );

  it('keeps login code and state out of the HTTP request target', () => {
    const handoffUrl = buildLoginHandoffUrl(rootBaseUrl, 'code-1', 'state-1');
    const requestTarget = handoffUrl.split('#')[0] ?? handoffUrl;

    expect(requestTarget).not.toContain('code-1');
    expect(requestTarget).not.toContain('state-1');
  });

  it('rejects an empty login state', () => {
    expect(() => buildLoginHandoffUrl(rootBaseUrl, 'code-1', '   ')).toThrow(
      'login state must not be empty',
    );
  });

  it('accepts an arbitrary same-origin HTTPS application path', () => {
    expect(
      validateReturnUrl(
        'https://MALL.example.com:443/orders/detail?id=1#summary',
        rootOrigin,
      ),
    ).toBe('https://mall.example.com/orders/detail?id=1#summary');
  });

  it.each([
    'https://evil.example/orders',
    'http://mall.example.com/orders',
    'https://user:pass@mall.example.com/orders',
    'https://mall.example.com:444/orders',
    'https://mall.example.com/%broken',
    'https://mall.example.com/orders?next=%ZZ',
  ])('rejects an unsafe or malformed return URL: %s', (returnUrl) => {
    expect(validateReturnUrl(returnUrl, rootOrigin)).toBeNull();
  });

  it('reloads a trusted return path with only an encoded phone credential handoff', () => {
    expect(
      buildPhoneCredentialHandoffUrl(
        'https://mall.example.com/login?redirect=%2Forders&wechatCode=old#form',
        rootOrigin,
        ' phone code&next ',
      ),
    ).toBe(
      'https://mall.example.com/login?redirect=%2Forders&miniappSource=bake-miniapp&miniappType=PHONE_CREDENTIAL&phoneCredential=phone%20code%26next#form',
    );
  });

  it('rejects untrusted return URLs and empty phone credentials', () => {
    expect(() =>
      buildPhoneCredentialHandoffUrl(
        'https://evil.example/steal',
        rootOrigin,
        'phone-code',
      ),
    ).toThrow('return URL is not allowed');
    expect(() =>
      buildPhoneCredentialHandoffUrl(rootBaseUrl, rootOrigin, '   '),
    ).toThrow('phone credential must not be empty');
  });
});

describe('miniapp route parameter decoding', () => {
  it('accepts an already-decoded HTTPS URL without decoding its encoded query', () => {
    expect(
      decodeRouteParameter(
        'https://mall.example.com/login?redirect=%2Forders%3Ftab%3Dnew',
      ),
    ).toBe('https://mall.example.com/login?redirect=%2Forders%3Ftab%3Dnew');
  });

  it('decodes an encoded HTTPS URL exactly once', () => {
    expect(
      decodeRouteParameter(
        encodeURIComponent('https://mall.example.com/login?redirect=%2Forders'),
      ),
    ).toBe('https://mall.example.com/login?redirect=%2Forders');
  });

  it.each(['', '%E0%A4%A', '%2568ttps%253A%252F%252Fevil.example'])(
    'rejects empty, malformed, or double-encoded input: %s',
    (value) => {
      expect(decodeRouteParameter(value)).toBeNull();
    },
  );

  it('decodes at most once and validates the page return URL against the build origin', () => {
    expect(
      resolvePhoneAuthReturnUrl(
        encodeURIComponent('https://mall.example.com/profile?tab=phone'),
        rootOrigin,
      ),
    ).toBe('https://mall.example.com/profile?tab=phone');
    expect(
      resolvePhoneAuthReturnUrl(
        'https://mall.example.com/login?next=%2Fme',
        rootOrigin,
      ),
    ).toBe('https://mall.example.com/login?next=%2Fme');
    expect(
      resolvePhoneAuthReturnUrl(
        encodeURIComponent('https://evil.example/steal'),
        rootOrigin,
      ),
    ).toBeNull();
  });
});

describe('miniapp explicit WeChat login route and in-memory handoff', () => {
  it('resolves an encoded return URL exactly once against the configured origin', () => {
    expect(
      resolveWechatLoginReturnUrl(
        encodeURIComponent(
          'https://mall.example.com/login?redirect=%2Fcheckout',
        ),
        rootOrigin,
      ),
    ).toBe('https://mall.example.com/login?redirect=%2Fcheckout');

    expect(
      resolveWechatLoginReturnUrl(
        encodeURIComponent('https://evil.example/steal'),
        rootOrigin,
      ),
    ).toBeNull();
  });

  it.each([
    'https://mall.example.com/path%5Csteal',
    'https://mall.example.com/path%255Csteal',
    'https://mall.example.com/path%0Asteal',
    'https://mall.example.com:444/login',
  ])(
    'rejects encoded separators, controls, double encoding, and port changes: %s',
    (value) => {
      expect(resolveWechatLoginReturnUrl(value, rootOrigin)).toBeNull();
    },
  );

  it('keeps login and phone handoffs in independent one-time slots', () => {
    const loginStore = createWechatLoginHandoffStore();
    const phoneStore = createPhoneCredentialHandoffStore();
    const loginHandoff = {
      code: 'login-code',
      returnUrl: 'https://mall.example.com/login',
      state: 'state-1',
    };
    const phoneHandoff = {
      credential: 'phone-code',
      returnUrl: 'https://mall.example.com/profile',
    };

    expect(loginStore.write(loginHandoff)).toBe(true);
    expect(phoneStore.write(phoneHandoff)).toBe(true);
    expect(loginStore.peek()).toEqual(loginHandoff);
    expect(phoneStore.peek()).toEqual(phoneHandoff);
    expect(loginStore.consume(loginHandoff)).toBe(true);
    expect(phoneStore.peek()).toEqual(phoneHandoff);
  });

  it('does not persist login codes through WeChat storage', () => {
    const setStorage = vi.fn();
    const setStorageSync = vi.fn();
    vi.stubGlobal('wx', { setStorage, setStorageSync });
    const store = createWechatLoginHandoffStore();

    store.write({
      code: 'login-code',
      returnUrl: 'https://mall.example.com/login',
      state: 'state-1',
    });

    expect(setStorage).not.toHaveBeenCalled();
    expect(setStorageSync).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('runs wx.login only after a click and navigates back after a non-empty code is stored', async () => {
    const login = vi.fn().mockResolvedValue(' login-code ');
    const writeHandoff = vi.fn(() => true);
    const navigateBack = vi.fn();
    const toast = vi.fn();
    const controller = createWechatLoginController({
      login,
      navigateBack,
      returnUrl: 'https://mall.example.com/login',
      state: 'state-1',
      toast,
      writeHandoff,
    });

    expect(login).not.toHaveBeenCalled();
    await expect(controller.handleLogin()).resolves.toBe(true);
    expect(writeHandoff).toHaveBeenCalledWith({
      code: 'login-code',
      returnUrl: 'https://mall.example.com/login',
      state: 'state-1',
    });
    expect(navigateBack).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });

  it('stays on the native page after login failure so the user can retry', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new Error('login failed'))
      .mockResolvedValueOnce('retry-code');
    const writeHandoff = vi.fn(() => true);
    const navigateBack = vi.fn();
    const toast = vi.fn();
    const controller = createWechatLoginController({
      login,
      navigateBack,
      returnUrl: 'https://mall.example.com/login',
      state: 'state-1',
      toast,
      writeHandoff,
    });

    await expect(controller.handleLogin()).resolves.toBe(false);
    expect(navigateBack).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('微信登录失败，请重试');

    await expect(controller.handleLogin()).resolves.toBe(true);
    expect(navigateBack).toHaveBeenCalledOnce();
  });
});

describe('miniapp in-memory phone handoff', () => {
  it('peeks and conditionally consumes a valid handoff once', () => {
    const store = createPhoneCredentialHandoffStore();
    const handoff = {
      credential: 'phone-code',
      returnUrl: 'https://mall.example.com/login',
    };

    expect(store.write(handoff)).toBe(true);
    expect(store.peek()).toEqual(handoff);
    expect(store.consume(handoff)).toBe(true);
    expect(store.peek()).toBeNull();
    expect(store.consume(handoff)).toBe(false);
  });

  it('does not consume a newer handoff through a stale completion callback', () => {
    const store = createPhoneCredentialHandoffStore();
    const first = {
      credential: 'phone-code-1',
      returnUrl: 'https://mall.example.com/login',
    };
    const second = {
      credential: 'phone-code-2',
      returnUrl: 'https://mall.example.com/profile',
    };

    store.write(first);
    store.write(second);

    expect(store.consume(first)).toBe(false);
    expect(store.peek()).toEqual(second);
  });

  it('does not write empty values', () => {
    const store = createPhoneCredentialHandoffStore();

    expect(
      store.write({
        credential: '   ',
        returnUrl: 'https://mall.example.com/login',
      }),
    ).toBe(false);
    expect(store.peek()).toBeNull();
  });
});

describe('miniapp profile outcome handoff', () => {
  it.each(['PROFILE_UPDATED', 'PROFILE_SKIPPED'] as const)(
    'builds and consumes a one-time %s handoff without profile data',
    (outcome) => {
      const store = createProfileHandoffStore();
      const handoff = {
        outcome,
        returnUrl: 'https://mall.example.com/profile?keep=1',
      };

      expect(store.write(handoff)).toBe(true);
      expect(store.peek()).toEqual(handoff);
      expect(
        buildProfileHandoffUrl(handoff.returnUrl, rootOrigin, outcome),
      ).toBe(
        `https://mall.example.com/profile?keep=1&miniappSource=bake-miniapp&miniappType=${outcome}`,
      );
      expect(store.consume(handoff)).toBe(true);
      expect(store.peek()).toBeNull();
    },
  );

  it('delivers profile outcome before phone and consumes only the matching load', () => {
    const profileHandoff = {
      outcome: 'PROFILE_UPDATED' as const,
      returnUrl: 'https://mall.example.com/profile',
    };
    const consumeProfileHandoff = vi.fn(() => true);
    const consumePhoneHandoff = vi.fn(() => true);
    const rebuildWebView = createSuccessfulRebuild();
    const controller = createIndexPageController({
      baseOrigin: rootOrigin,
      baseUrl: rootBaseUrl,
      consumePhoneHandoff,
      consumeProfileHandoff,
      consumeWechatLoginHandoff: () => false,
      peekPhoneHandoff: () => ({
        credential: 'phone-code',
        returnUrl: 'https://mall.example.com/profile',
      }),
      peekProfileHandoff: () => profileHandoff,
      peekWechatLoginHandoff: () => null,
      rebuildWebView,
      toast: vi.fn(),
    });

    expect(controller.handleShow()).toBe(true);
    const [url, deliveryId] = rebuildWebView.mock.calls[0] ?? [];
    expect(url).toContain('miniappType=PROFILE_UPDATED');
    expect(url).not.toContain('phoneCredential');
    expect(controller.handleWebViewLoad('stale')).toBe(false);
    expect(consumeProfileHandoff).not.toHaveBeenCalled();
    expect(controller.handleWebViewLoad(deliveryId)).toBe(true);
    expect(consumeProfileHandoff).toHaveBeenCalledWith(profileHandoff);
  });
});

describe('miniapp page controllers', () => {
  it('loads the clean base URL on the first show without a pending handoff', () => {
    const rebuildWebView = createSuccessfulRebuild();
    const controller = createIndexPageController({
      baseUrl: rootBaseUrl,
      baseOrigin: rootOrigin,
      consumeWechatLoginHandoff: () => false,
      peekWechatLoginHandoff: () => null,
      peekPhoneHandoff: () => null,
      consumePhoneHandoff: () => false,
      rebuildWebView,
      toast: vi.fn(),
    });

    expect(controller.handleShow()).toBe(true);
    expect(controller.handleShow()).toBe(false);
    expect(rebuildWebView).toHaveBeenCalledOnce();
    expect(rebuildWebView).toHaveBeenCalledWith(rootBaseUrl, '');
  });

  it('retries the clean base URL after an initial web-view rebuild failure', () => {
    const rebuildWebView = vi
      .fn<(url: string, deliveryId: string) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const controller = createIndexPageController({
      baseUrl: rootBaseUrl,
      baseOrigin: rootOrigin,
      consumeWechatLoginHandoff: () => false,
      peekWechatLoginHandoff: () => null,
      peekPhoneHandoff: () => null,
      consumePhoneHandoff: () => false,
      rebuildWebView,
      toast: vi.fn(),
    });

    expect(controller.handleShow()).toBe(false);
    expect(controller.handleShow()).toBe(true);
    expect(rebuildWebView).toHaveBeenCalledTimes(2);
  });

  it('rejects unbound automatic login codes and falls back to the clean base URL', () => {
    const rebuildWebView = createSuccessfulRebuild();
    const toast = vi.fn();
    const controller = createIndexPageController({
      baseUrl: rootBaseUrl,
      baseOrigin: rootOrigin,
      consumeWechatLoginHandoff: () => false,
      peekWechatLoginHandoff: () => null,
      peekPhoneHandoff: () => null,
      consumePhoneHandoff: () => false,
      rebuildWebView,
      toast,
    });

    expect(controller.handleLoginSuccess(' code-1 ')).toBe(false);
    expect(rebuildWebView).toHaveBeenLastCalledWith(rootBaseUrl, '');

    expect(controller.handleLoginSuccess('   ')).toBe(false);
    expect(controller.handleLoginFailure()).toBe(false);
    expect(rebuildWebView).toHaveBeenLastCalledWith(
      rootBaseUrl,
      expect.any(String),
    );
    expect(toast).toHaveBeenCalled();
  });

  it('delivers explicit login before phone when both handoffs are pending', () => {
    const loginHandoff = {
      code: 'explicit-code',
      returnUrl: 'https://mall.example.com/login?redirect=%2Fcheckout',
      state: 'state-1',
    };
    const phoneHandoff = {
      credential: 'phone-code',
      returnUrl: 'https://mall.example.com/profile',
    };
    let pendingLogin: typeof loginHandoff | null = loginHandoff;
    const consumeWechatLoginHandoff = vi.fn(() => {
      pendingLogin = null;
      return true;
    });
    const consumePhoneHandoff = vi.fn(() => true);
    const rebuildWebView = createSuccessfulRebuild();
    const controller = createIndexPageController({
      baseOrigin: rootOrigin,
      baseUrl: rootBaseUrl,
      consumePhoneHandoff,
      consumeWechatLoginHandoff,
      peekPhoneHandoff: () => phoneHandoff,
      peekWechatLoginHandoff: () => pendingLogin,
      rebuildWebView,
      toast: vi.fn(),
    });

    expect(controller.handleShow()).toBe(true);
    const [targetUrl, deliveryId] = rebuildWebView.mock.calls[0] ?? [];
    expect(targetUrl).toContain('wechatCode=explicit-code');
    expect(targetUrl).not.toContain('phoneCredential=phone-code');
    expect(controller.handleWebViewLoad(deliveryId)).toBe(true);
    expect(consumeWechatLoginHandoff).toHaveBeenCalledWith(loginHandoff);
    expect(consumePhoneHandoff).not.toHaveBeenCalled();

    expect(controller.handleShow()).toBe(true);
    expect(rebuildWebView.mock.calls[1]?.[0]).toContain(
      'phoneCredential=phone-code',
    );
  });

  it('does not let a late automatic login overwrite an explicit handoff delivery', () => {
    const loginHandoff = {
      code: 'explicit-code',
      returnUrl: 'https://mall.example.com/login',
      state: 'state-1',
    };
    const consumeWechatLoginHandoff = vi.fn(() => true);
    const rebuildWebView = createSuccessfulRebuild();
    const controller = createIndexPageController({
      baseOrigin: rootOrigin,
      baseUrl: rootBaseUrl,
      consumePhoneHandoff: () => false,
      consumeWechatLoginHandoff,
      peekPhoneHandoff: () => null,
      peekWechatLoginHandoff: () => loginHandoff,
      rebuildWebView,
      toast: vi.fn(),
    });

    expect(controller.handleShow()).toBe(true);
    const explicitDeliveryId = rebuildWebView.mock.calls[0]?.[1];
    expect(controller.handleLoginSuccess('late-auto-code')).toBe(false);
    expect(rebuildWebView).toHaveBeenCalledOnce();
    expect(controller.handleWebViewLoad(explicitDeliveryId)).toBe(true);
    expect(consumeWechatLoginHandoff).toHaveBeenCalledWith(loginHandoff);
  });

  it('keeps an explicit login handoff on errors, failed rebuilds, and stale loads', () => {
    const first = {
      code: 'explicit-code-1',
      returnUrl: 'https://mall.example.com/login',
      state: 'state-1',
    };
    const second = {
      code: 'explicit-code-2',
      returnUrl: 'https://mall.example.com/checkout',
      state: 'state-2',
    };
    let current = first;
    const consumeWechatLoginHandoff = vi.fn(() => true);
    const rebuildWebView = createSuccessfulRebuild();
    const controller = createIndexPageController({
      baseOrigin: rootOrigin,
      baseUrl: rootBaseUrl,
      consumePhoneHandoff: () => false,
      consumeWechatLoginHandoff,
      peekPhoneHandoff: () => null,
      peekWechatLoginHandoff: () => current,
      rebuildWebView,
      toast: vi.fn(),
    });

    expect(controller.handleShow()).toBe(true);
    const firstDeliveryId = rebuildWebView.mock.calls[0]?.[1];
    expect(controller.handleWebViewError(firstDeliveryId)).toBe(true);
    expect(consumeWechatLoginHandoff).not.toHaveBeenCalled();

    current = second;
    expect(controller.handleShow()).toBe(true);
    const secondDeliveryId = rebuildWebView.mock.calls[1]?.[1];
    expect(controller.handleWebViewLoad(firstDeliveryId)).toBe(false);
    expect(consumeWechatLoginHandoff).not.toHaveBeenCalled();
    expect(controller.handleWebViewLoad(secondDeliveryId)).toBe(true);
    expect(consumeWechatLoginHandoff).toHaveBeenCalledWith(second);

    const failedController = createIndexPageController({
      baseOrigin: rootOrigin,
      baseUrl: rootBaseUrl,
      consumePhoneHandoff: () => false,
      consumeWechatLoginHandoff,
      peekPhoneHandoff: () => null,
      peekWechatLoginHandoff: () => first,
      rebuildWebView: () => false,
      toast: vi.fn(),
    });
    expect(failedController.handleShow()).toBe(false);
    expect(consumeWechatLoginHandoff).toHaveBeenCalledOnce();
  });

  it('consumes a phone handoff only after the matching web-view load', () => {
    const handoff = {
      credential: 'phone-code',
      returnUrl: 'https://mall.example.com/login?keep=1',
    };
    const consumePhoneHandoff = vi.fn(() => true);
    const rebuildWebView = vi.fn((...args: [string, string]): boolean => {
      expect(args).toHaveLength(2);
      return true;
    });
    const controller = createIndexPageController({
      baseUrl: rootBaseUrl,
      baseOrigin: rootOrigin,
      consumeWechatLoginHandoff: () => false,
      peekWechatLoginHandoff: () => null,
      peekPhoneHandoff: () => handoff,
      consumePhoneHandoff,
      rebuildWebView,
      toast: vi.fn(),
    });

    expect(controller.handleShow()).toBe(true);
    const [targetUrl, deliveryId] = rebuildWebView.mock.calls[0] ?? [];
    expect(targetUrl).toEqual(
      expect.stringContaining('phoneCredential=phone-code'),
    );
    expect(deliveryId).toEqual(expect.any(String));
    expect(consumePhoneHandoff).not.toHaveBeenCalled();

    expect(controller.handleWebViewLoad(deliveryId)).toBe(true);
    expect(consumePhoneHandoff).toHaveBeenCalledWith(handoff);
  });

  it('keeps a pending handoff after web-view error so the matching load can retry', () => {
    const handoff = {
      credential: 'phone-code',
      returnUrl: 'https://mall.example.com/login',
    };
    const consumePhoneHandoff = vi.fn(() => true);
    const rebuildWebView = vi.fn((...args: [string, string]): boolean => {
      expect(args).toHaveLength(2);
      return true;
    });
    const controller = createIndexPageController({
      baseUrl: rootBaseUrl,
      baseOrigin: rootOrigin,
      consumeWechatLoginHandoff: () => false,
      peekWechatLoginHandoff: () => null,
      peekPhoneHandoff: () => handoff,
      consumePhoneHandoff,
      rebuildWebView,
      toast: vi.fn(),
    });

    expect(controller.handleShow()).toBe(true);
    const [, deliveryId] = rebuildWebView.mock.calls[0] ?? [];
    controller.handleWebViewError(deliveryId);
    expect(consumePhoneHandoff).not.toHaveBeenCalled();

    expect(controller.handleWebViewLoad(deliveryId)).toBe(true);
    expect(consumePhoneHandoff).toHaveBeenCalledWith(handoff);
  });

  it('does not consume a newer handoff when an old web-view load arrives late', () => {
    const first = {
      credential: 'phone-code-1',
      returnUrl: 'https://mall.example.com/login',
    };
    const second = {
      credential: 'phone-code-2',
      returnUrl: 'https://mall.example.com/profile',
    };
    let currentHandoff = first;
    const consumePhoneHandoff = vi.fn(() => true);
    const rebuildWebView = vi.fn((...args: [string, string]): boolean => {
      expect(args).toHaveLength(2);
      return true;
    });
    const controller = createIndexPageController({
      baseUrl: rootBaseUrl,
      baseOrigin: rootOrigin,
      consumeWechatLoginHandoff: () => false,
      peekWechatLoginHandoff: () => null,
      peekPhoneHandoff: () => currentHandoff,
      consumePhoneHandoff,
      rebuildWebView,
      toast: vi.fn(),
    });

    controller.handleShow();
    const firstDeliveryId = rebuildWebView.mock.calls[0]?.[1];
    currentHandoff = second;
    controller.handleShow();
    const secondDeliveryId = rebuildWebView.mock.calls[1]?.[1];

    expect(controller.handleWebViewLoad(firstDeliveryId)).toBe(false);
    expect(consumePhoneHandoff).not.toHaveBeenCalled();
    expect(controller.handleWebViewLoad(secondDeliveryId)).toBe(true);
    expect(consumePhoneHandoff).toHaveBeenCalledWith(second);
  });

  it('does not consume a handoff after a newer non-handoff web-view rebuild', () => {
    const handoff = {
      credential: 'phone-code',
      returnUrl: 'https://mall.example.com/login',
    };
    const consumePhoneHandoff = vi.fn(() => true);
    const rebuildWebView = vi.fn((...args: [string, string]): boolean => {
      expect(args).toHaveLength(2);
      return true;
    });
    const controller = createIndexPageController({
      baseUrl: rootBaseUrl,
      baseOrigin: rootOrigin,
      consumeWechatLoginHandoff: () => false,
      peekWechatLoginHandoff: () => null,
      peekPhoneHandoff: () => handoff,
      consumePhoneHandoff,
      rebuildWebView,
      toast: vi.fn(),
    });

    controller.handleShow();
    const staleDeliveryId = rebuildWebView.mock.calls[0]?.[1];
    controller.handleLoginSuccess('new-login-code');

    expect(controller.handleWebViewLoad(staleDeliveryId)).toBe(false);
    expect(consumePhoneHandoff).not.toHaveBeenCalled();
  });

  it('keeps the credential when web-view reconstruction throws or fails', () => {
    const handoff = {
      credential: 'phone-code',
      returnUrl: 'https://mall.example.com/login',
    };
    const consumePhoneHandoff = vi.fn(() => true);
    const createController = (rebuildWebView: () => boolean) =>
      createIndexPageController({
        baseUrl: rootBaseUrl,
        baseOrigin: rootOrigin,
        consumeWechatLoginHandoff: () => false,
        peekWechatLoginHandoff: () => null,
        peekPhoneHandoff: () => handoff,
        consumePhoneHandoff,
        rebuildWebView,
        toast: vi.fn(),
      });

    expect(createController(() => false).handleShow()).toBe(false);
    expect(
      createController(() => {
        throw new Error('setData failed');
      }).handleShow(),
    ).toBe(false);
    expect(consumePhoneHandoff).not.toHaveBeenCalled();
  });

  it('rejects an untrusted return URL without consuming it', () => {
    const consumePhoneHandoff = vi.fn(() => true);
    const toast = vi.fn();
    const controller = createIndexPageController({
      baseUrl: rootBaseUrl,
      baseOrigin: rootOrigin,
      consumeWechatLoginHandoff: () => false,
      peekWechatLoginHandoff: () => null,
      peekPhoneHandoff: () => ({
        credential: 'phone-code',
        returnUrl: 'https://evil.example/steal',
      }),
      consumePhoneHandoff,
      rebuildWebView: createSuccessfulRebuild(),
      toast,
    });

    expect(controller.handleShow()).toBe(false);
    expect(consumePhoneHandoff).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('手机号授权返回地址无效');
  });

  it('writes successful phone authorization to memory and navigates back only then', () => {
    const writeHandoff = vi.fn(() => true);
    const navigateBack = vi.fn();
    const toast = vi.fn();
    const controller = createPhoneAuthController({
      returnUrl: 'https://mall.example.com/login',
      writeHandoff,
      navigateBack,
      toast,
    });

    expect(
      controller.handleAuthorization({
        code: ' phone-code ',
        errMsg: 'getPhoneNumber:ok',
        errno: 0,
      }),
    ).toBe(true);
    expect(writeHandoff).toHaveBeenCalledWith({
      credential: 'phone-code',
      returnUrl: 'https://mall.example.com/login',
    });
    expect(navigateBack).toHaveBeenCalledOnce();

    expect(
      controller.handleAuthorization({
        errMsg: 'getPhoneNumber:fail user deny',
        errno: 10001,
      }),
    ).toBe(false);
    expect(writeHandoff).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith('未完成手机号授权');
  });
});

describe('miniapp authorization parsing', () => {
  it('accepts a trimmed wx.login code only when non-empty', () => {
    expect(parseLoginCode(' code-1 ')).toBe('code-1');
    expect(parseLoginCode('')).toBeNull();
  });

  it('accepts only a modern successful getPhoneNumber code', () => {
    expect(
      parsePhoneCredential({
        code: ' phone-code-1 ',
        errMsg: 'getPhoneNumber:ok',
        errno: 0,
      }),
    ).toBe('phone-code-1');
    expect(
      parsePhoneCredential({
        code: 'ignored',
        errMsg: 'getPhoneNumber:fail user deny',
        errno: 10001,
      }),
    ).toBeNull();
    expect(
      parsePhoneCredential({
        code: '',
        errMsg: 'getPhoneNumber:ok',
        errno: 0,
      }),
    ).toBeNull();
    const legacyDetail: Readonly<Record<string, unknown>> = {
      encryptedData: 'legacy-value',
      errMsg: 'getPhoneNumber:ok',
      errno: 0,
    };
    expect(parsePhoneCredential(legacyDetail)).toBeNull();
  });
});

describe('miniapp H5 build configuration', () => {
  it('accepts only a root absolute HTTPS URL without credentials', () => {
    expect(requireHttpsH5Url('https://MALL.example.com:443')).toBe(
      'https://mall.example.com/',
    );
    expect(requireHttpsH5Url('https://mall.example.com/?campaign=1#hero')).toBe(
      'https://mall.example.com/?campaign=1#hero',
    );
    expect(() => requireHttpsH5Url('http://mall.example.com')).toThrow('HTTPS');
    expect(() => requireHttpsH5Url('https://user:pass@example.com')).toThrow(
      'credentials',
    );
    expect(() => requireHttpsH5Url('https://mall.example.com/shop/')).toThrow(
      'root pathname',
    );
    expect(() =>
      requireHttpsH5Url('https://mall.example.com/?next=%ZZ'),
    ).toThrow('percent encoding');
    expect(() => requireHttpsH5Url('')).toThrow('required');
  });

  it('fails closed when the formal build URL is missing or insecure', () => {
    expect(() => resolveBuildH5Url(undefined)).toThrow(
      'MINIAPP_H5_URL is required',
    );
    expect(() => resolveBuildH5Url('http://mall.example.com')).toThrow('HTTPS');
    expect(resolveBuildH5Url('https://mall.example.com')).toBe(rootBaseUrl);
  });

  it('generates deterministic normalized base and origin constants', () => {
    expect(createMiniappConfigSource('https://MALL.example.com:443/')).toBe(
      "export const MINIAPP_H5_URL = 'https://mall.example.com/';\nexport const MINIAPP_H5_ORIGIN = 'https://mall.example.com';\n",
    );
  });
});

describe('miniapp build-check integration', () => {
  const generatedConfigUrl = new URL(
    '../config/h5.generated.js',
    import.meta.url,
  );
  let originalContent: string | null = null;

  afterEach(async () => {
    if (originalContent === null) await rm(generatedConfigUrl, { force: true });
    else await writeFile(generatedConfigUrl, originalContent, 'utf8');
  });

  it('does not alter the generated production config sentinel', async () => {
    try {
      await access(generatedConfigUrl);
      originalContent = await readFile(generatedConfigUrl, 'utf8');
    } catch {
      originalContent = null;
    }
    const sentinel =
      "export const MINIAPP_H5_URL = 'https://sentinel.example/';\nexport const MINIAPP_H5_ORIGIN = 'https://sentinel.example';\n";
    await writeFile(generatedConfigUrl, sentinel, 'utf8');

    await expect(
      execFileAsync(
        process.execPath,
        [fileURLToPath(new URL('../scripts/build-check.mjs', import.meta.url))],
        {
          env: {
            ...process.env,
            MINIAPP_H5_URL: 'https://mall.example.com/',
          },
        },
      ),
    ).rejects.toThrow('generated H5 runtime');

    expect(await readFile(generatedConfigUrl, 'utf8')).toBe(sentinel);
  });
});
