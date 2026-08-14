import { describe, expect, it, vi } from 'vitest';

import { ApiErrorCode } from '@bake-mall/contracts';

import {
  WECHAT_REQUEST_TIMEOUT_MS,
  WechatAuthAdapter,
} from './wechat-auth.adapter.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const createAdapter = (fetcher: typeof fetch) =>
  new WechatAuthAdapter(
    {
      get: vi.fn().mockReturnValue({
        WECHAT_APP_ID: 'wx-test-app-id',
        WECHAT_APP_SECRET: 'wx-test-secret',
      }),
    } as never,
    fetcher,
  );

const expectSafeWechatFailure = async (
  operation: Promise<unknown>,
  code: ApiErrorCode,
): Promise<void> => {
  await expect(operation).rejects.toMatchObject({
    code,
    message: expect.not.stringMatching(
      /wx-test-secret|one-time-login-code|one-time-phone-code/u,
    ),
  });
};

describe('WechatAuthAdapter', () => {
  it('exchanges a login code with an abort timeout and returns only strict identity fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        openid: 'openid-1',
        unionid: 'unionid-1',
        session_key: 'vendor-session-secret',
      }),
    );
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.exchangeLoginCode('one-time-login-code'),
    ).resolves.toEqual({ openid: 'openid-1', unionid: 'unionid-1' });
    const [requestUrl, requestInit] = fetcher.mock.calls[0] ?? [];
    expect(String(requestUrl)).toContain('/sns/jscode2session');
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
    expect(WECHAT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('rejects a response without a non-empty openid', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ session_key: 'secret' }));
    const adapter = createAdapter(fetcher);

    await expectSafeWechatFailure(
      adapter.exchangeLoginCode('one-time-login-code'),
      ApiErrorCode.WECHAT_AUTH_FAILED,
    );
  });

  it('rejects malformed phone_info instead of coercing vendor data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'vendor-token' }))
      .mockResolvedValueOnce(
        jsonResponse({ phone_info: { purePhoneNumber: 13800000000 } }),
      );
    const adapter = createAdapter(fetcher);

    await expectSafeWechatFailure(
      adapter.exchangePhoneCredential('one-time-phone-code'),
      ApiErrorCode.WECHAT_AUTH_FAILED,
    );
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [40029, ApiErrorCode.WECHAT_AUTH_FAILED],
    [40163, ApiErrorCode.WECHAT_AUTH_FAILED],
    [-1, ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE],
  ] as const)(
    'maps vendor errcode %s to a safe category',
    async (errcode, code) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          errcode,
          errmsg:
            'vendor detail contains one-time-login-code and wx-test-secret',
        }),
      );
      const adapter = createAdapter(fetcher);

      await expectSafeWechatFailure(
        adapter.exchangeLoginCode('one-time-login-code'),
        code,
      );
    },
  );

  it('maps timeout/network failures without leaking app secret or credential', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const adapter = createAdapter(fetcher);
    const operation = expectSafeWechatFailure(
      adapter.exchangeLoginCode('one-time-login-code'),
      ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE,
    );

    await vi.advanceTimersByTimeAsync(WECHAT_REQUEST_TIMEOUT_MS);
    await operation;
    vi.useRealTimers();
  });

  it('exchanges a phone credential through getPhoneNumber and returns normalized vendor phone', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'vendor-token' }))
      .mockResolvedValueOnce(
        jsonResponse({
          phone_info: {
            phoneNumber: '+8613800000000',
            purePhoneNumber: '13800000000',
            countryCode: '86',
          },
        }),
      );
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.exchangePhoneCredential('one-time-phone-code'),
    ).resolves.toEqual({ phoneNumber: '13800000000' });
    expect(String(fetcher.mock.calls[1]?.[0])).toContain(
      '/wxa/business/getuserphonenumber',
    );
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain(
      'one-time-phone-code',
    );
  });
});
