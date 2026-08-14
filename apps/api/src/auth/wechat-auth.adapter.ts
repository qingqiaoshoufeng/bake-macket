import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiErrorCode } from '@bake-mall/contracts';

import { type AppConfig } from '../config/env.schema.js';

const WECHAT_API_ORIGIN = 'https://api.weixin.qq.com';
export const WECHAT_REQUEST_TIMEOUT_MS = 5_000;
export const WECHAT_FETCHER = Symbol('WECHAT_FETCHER');

export type WechatLoginIdentity = Readonly<{
  openid: string;
  unionid: string | null;
}>;

export type WechatPhoneIdentity = Readonly<{
  phoneNumber: string;
}>;

export class WechatAuthAdapterError extends Error {
  constructor(
    readonly code:
      ApiErrorCode.WECHAT_AUTH_FAILED | ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE,
  ) {
    super(
      code === ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE
        ? 'WeChat authentication is temporarily unavailable.'
        : 'WeChat credential is invalid or expired.',
    );
    this.name = 'WechatAuthAdapterError';
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function vendorFailureCode(
  payload: Readonly<Record<string, unknown>>,
):
  | ApiErrorCode.WECHAT_AUTH_FAILED
  | ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE
  | null {
  if (typeof payload.errcode !== 'number' || payload.errcode === 0) return null;
  return payload.errcode === -1
    ? ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE
    : ApiErrorCode.WECHAT_AUTH_FAILED;
}

function adapterError(
  code:
    ApiErrorCode.WECHAT_AUTH_FAILED | ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE,
): WechatAuthAdapterError {
  return new WechatAuthAdapterError(code);
}

@Injectable()
export class WechatAuthAdapter {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    @Optional()
    @Inject(WECHAT_FETCHER)
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async exchangeLoginCode(code: string): Promise<WechatLoginIdentity> {
    const { WECHAT_APP_ID, WECHAT_APP_SECRET } = this.environment();
    const url = new URL('/sns/jscode2session', WECHAT_API_ORIGIN);
    url.searchParams.set('appid', WECHAT_APP_ID);
    url.searchParams.set('secret', WECHAT_APP_SECRET);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const payload = await this.requestJson(url, { method: 'GET' });
    const openid = nonEmptyString(payload.openid);
    if (!openid) throw adapterError(ApiErrorCode.WECHAT_AUTH_FAILED);
    const unionid = nonEmptyString(payload.unionid);
    return { openid, unionid };
  }

  async exchangePhoneCredential(code: string): Promise<WechatPhoneIdentity> {
    const accessToken = await this.getAccessToken();
    const url = new URL('/wxa/business/getuserphonenumber', WECHAT_API_ORIGIN);
    url.searchParams.set('access_token', accessToken);
    const payload = await this.requestJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const phoneInfo = safeRecord(payload.phone_info);
    const phoneNumber = nonEmptyString(phoneInfo?.purePhoneNumber);
    if (!phoneInfo || !phoneNumber) {
      throw adapterError(ApiErrorCode.WECHAT_AUTH_FAILED);
    }
    return { phoneNumber };
  }

  private environment() {
    return this.config.get('appEnv', { infer: true });
  }

  private async getAccessToken(): Promise<string> {
    const { WECHAT_APP_ID, WECHAT_APP_SECRET } = this.environment();
    const url = new URL('/cgi-bin/token', WECHAT_API_ORIGIN);
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', WECHAT_APP_ID);
    url.searchParams.set('secret', WECHAT_APP_SECRET);
    const payload = await this.requestJson(url, { method: 'GET' });
    const accessToken = nonEmptyString(payload.access_token);
    if (!accessToken) throw adapterError(ApiErrorCode.WECHAT_AUTH_FAILED);
    return accessToken;
  }

  private async requestJson(
    url: URL,
    init: Omit<RequestInit, 'signal'>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      WECHAT_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw adapterError(ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE);
      }
      const payload = safeRecord(await response.json());
      if (!payload) throw adapterError(ApiErrorCode.WECHAT_AUTH_FAILED);
      const failureCode = vendorFailureCode(payload);
      if (failureCode) throw adapterError(failureCode);
      return payload;
    } catch (error) {
      if (error instanceof WechatAuthAdapterError) throw error;
      throw adapterError(ApiErrorCode.WECHAT_SERVICE_UNAVAILABLE);
    } finally {
      clearTimeout(timeout);
    }
  }
}
