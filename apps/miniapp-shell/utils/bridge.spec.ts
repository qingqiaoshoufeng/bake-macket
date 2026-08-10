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
  createIndexPageController,
  createPhoneAuthController,
  createPhoneCredentialHandoffStore,
  decodeRouteParameter,
  parseLoginCode,
  resolvePhoneAuthReturnUrl,
  parsePhoneCredential,
  validateReturnUrl,
} from './bridge.js';

const rootBaseUrl = 'https://mall.example.com/';
const rootOrigin = 'https://mall.example.com';
const execFileAsync = promisify(execFile);

function createSuccessfulRebuild() {
  return vi.fn((): boolean => true);
}

describe('miniapp URL handoff', () => {
  it('loads H5 with an encoded one-time login code while preserving query and hash', () => {
    expect(
      buildLoginHandoffUrl(
        'https://MALL.example.com:443/?campaign=summer#hero',
        ' login code&next ',
      ),
    ).toBe(
      'https://mall.example.com/?campaign=summer&miniappSource=bake-miniapp&miniappType=WECHAT_CODE&wechatCode=login%20code%26next#hero',
    );
  });

  it.each([undefined, null, '', '   ', 42])(
    'rejects an empty or invalid login code %#',
    (code) => {
      expect(parseLoginCode(code)).toBeNull();
      expect(() => buildLoginHandoffUrl(rootBaseUrl, code)).toThrow(
        'login code must not be empty',
      );
    },
  );

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

describe('miniapp page controllers', () => {
  it('gates initial web-view rendering on a rebuilt login URL', () => {
    const rebuildWebView = createSuccessfulRebuild();
    const toast = vi.fn();
    const controller = createIndexPageController({
      baseUrl: rootBaseUrl,
      baseOrigin: rootOrigin,
      peekPhoneHandoff: () => null,
      consumePhoneHandoff: () => false,
      rebuildWebView,
      toast,
    });

    expect(controller.handleLoginSuccess(' code-1 ')).toBe(true);
    expect(rebuildWebView).toHaveBeenLastCalledWith(
      expect.stringContaining('wechatCode=code-1'),
      expect.any(String),
    );

    expect(controller.handleLoginSuccess('   ')).toBe(false);
    expect(controller.handleLoginFailure()).toBe(false);
    expect(rebuildWebView).toHaveBeenLastCalledWith(
      rootBaseUrl,
      expect.any(String),
    );
    expect(toast).toHaveBeenCalled();
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
