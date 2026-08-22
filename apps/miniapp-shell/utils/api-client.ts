import type { ApiError } from '@bake-mall/contracts';

import { MINIAPP_API_BASE_URL } from '../config/api.generated.js';
import type { MemorySessionStore } from './admin-session.js';
import type {
  AdminSessionView,
  CustomerAuthSessionView,
} from '@bake-mall/contracts';

export const MINIAPP_API_REQUEST_TIMEOUT_MS = 10_000;

const HTTPS_API_BASE_PATTERN = /^https:\/\/([^/?#]+)\/api\/v1\/?$/i;
const DNS_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
const IPV6_AUTHORITY_PATTERN = /^(\[[0-9a-f:.]+\])(?::([0-9]+))?$/i;
const DNS_AUTHORITY_PATTERN = /^([^:]+)(?::([0-9]+))?$/;

type ApiAudience = 'admin' | 'customer';
type RequestMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
type SessionStores = Readonly<{
  adminSession: MemorySessionStore<AdminSessionView>;
  customerSession: MemorySessionStore<CustomerAuthSessionView>;
}>;
type MiniappApiClientDependencies = SessionStores &
  Readonly<{
    baseUrl?: string;
    request?: typeof wx.request;
    uploadFile?: typeof wx.uploadFile;
  }>;
export type MiniappApiRequestOptions = Readonly<{
  audience?: ApiAudience;
  header?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, number | string | undefined>>;
}>;

export type PresignedPostUpload = Readonly<{
  fields: Readonly<Record<string, string>>;
  filePath: string;
  uploadUrl: string;
}>;

type ErrorPayload = Readonly<{
  code?: ApiError['code'];
  details?: Record<string, unknown>;
  message: string;
  requestId?: string;
}>;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: ApiError['code'];
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  readonly cause?: unknown;

  constructor(
    status: number,
    message: string,
    options: Readonly<{
      cause?: unknown;
      code?: ApiError['code'];
      details?: Record<string, unknown>;
      requestId?: string;
    }> = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
    this.cause = options.cause;
  }
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function invalidBaseUrl(): never {
  throw new ApiClientError(0, '小程序 API base URL 配置无效');
}

function normalizeAuthority(authority: string): string | null {
  if (!authority || authority.includes('@')) return null;
  const match =
    authority.match(IPV6_AUTHORITY_PATTERN) ??
    authority.match(DNS_AUTHORITY_PATTERN);
  if (!match) return null;

  const host = match[1]?.toLowerCase() ?? '';
  const portText = match[2];
  if (!host || (!host.startsWith('[') && !DNS_HOST_PATTERN.test(host))) {
    return null;
  }
  if (!portText) return host;

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return port === 443 ? host : `${host}:${port}`;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim();
  if (containsControlCharacter(normalized) || normalized.includes('\\')) {
    return invalidBaseUrl();
  }
  const match = normalized.match(HTTPS_API_BASE_PATTERN);
  const authority = normalizeAuthority(match?.[1] ?? '');
  if (!authority) return invalidBaseUrl();
  return `https://${authority}/api/v1`;
}

function invalidPath(): never {
  throw new ApiClientError(0, '小程序 API path 无效');
}

function decodeCanonicalPath(pathname: string): string {
  const decodedLayers = Array.from({ length: 4 }).reduce<string>((current) => {
    if (/%(?:2f|5c)/i.test(current)) return invalidPath();
    const decoded = (() => {
      try {
        return decodeURIComponent(current);
      } catch {
        return invalidPath();
      }
    })();
    if (decoded.includes('\\')) return invalidPath();
    if (decoded !== current && /%[0-9a-f]{2}/i.test(decoded)) {
      return invalidPath();
    }
    return decoded;
  }, pathname);

  if (
    decodedLayers
      .split('/')
      .some((segment) => segment === '.' || segment === '..')
  ) {
    return invalidPath();
  }
  return decodedLayers;
}

function createRequestUrl(
  baseUrl: string,
  path: string,
  audience?: ApiAudience,
): string {
  const normalized = parseNonEmptyString(path);
  if (
    !normalized ||
    normalized !== path ||
    !normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    normalized.includes('?') ||
    normalized.includes('#') ||
    normalized.includes('\\') ||
    containsControlCharacter(normalized)
  ) {
    return invalidPath();
  }

  decodeCanonicalPath(normalized);

  const canonicalPathname = decodeCanonicalPath(`/api/v1${normalized}`);
  if (!canonicalPathname.startsWith('/api/v1/')) return invalidPath();

  const audiencePath = canonicalPathname.slice('/api/v1'.length);
  if (audience === 'admin' && !audiencePath.startsWith('/admin/')) {
    throw new ApiClientError(0, '管理会话不能用于非管理接口');
  }
  if (
    audience === 'customer' &&
    audiencePath.startsWith('/admin/') &&
    audiencePath !== '/admin/auth/exchange'
  ) {
    throw new ApiClientError(0, '顾客会话不能用于管理接口');
  }
  return `${baseUrl}${normalized}`;
}

function appendRequestQuery(
  requestUrl: string,
  query?: Readonly<Record<string, number | string | undefined>>,
): string {
  if (!query) return requestUrl;
  const entries = Object.entries(query).filter(
    (entry): entry is [string, number | string] =>
      entry[1] !== undefined && entry[1] !== '',
  );
  if (entries.length === 0) return requestUrl;
  const encoded = entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&');
  return `${requestUrl}?${encoded}`;
}

function readErrorPayload(status: number, data: unknown): ErrorPayload {
  const fallback = `请求失败（${status}）`;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { message: fallback };
  }
  const payload = data as Partial<ApiError>;
  return {
    message: parseNonEmptyString(payload.message) ?? fallback,
    ...(parseNonEmptyString(payload.code) ? { code: payload.code } : {}),
    ...(parseNonEmptyString(payload.requestId)
      ? { requestId: payload.requestId }
      : {}),
    ...(payload.details && typeof payload.details === 'object'
      ? { details: payload.details }
      : {}),
  };
}

function failureMessage(
  error: WechatMiniprogram.GeneralCallbackResult,
): string {
  return /timeout/i.test(error.errMsg)
    ? '请求超时，请稍后重试'
    : '网络异常，请稍后重试';
}

function normalizeRequestBody(
  body: unknown,
): string | WechatMiniprogram.IAnyObject | ArrayBuffer | undefined {
  if (body === undefined) return undefined;
  if (typeof body === 'string' || body instanceof ArrayBuffer) return body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as WechatMiniprogram.IAnyObject;
  }
  return JSON.stringify(body);
}

function defaultRequest(
  options: WechatMiniprogram.RequestOption,
): WechatMiniprogram.RequestTask {
  return wx.request(options);
}

function defaultUploadFile(
  options: WechatMiniprogram.UploadFileOption,
): WechatMiniprogram.UploadTask {
  return wx.uploadFile(options);
}

function requireSecureUploadUrl(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(/^https:\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?$/i);
  const authority = normalizeAuthority(match?.[1] ?? '');
  if (
    !authority ||
    normalized !== value ||
    containsControlCharacter(normalized) ||
    normalized.includes('\\')
  ) {
    throw new ApiClientError(0, '头像上传地址无效');
  }
  return `https://${authority}${match?.[2] ?? ''}${match?.[3] ?? ''}`;
}

export function createMiniappApiClient(
  dependencies: MiniappApiClientDependencies,
): Readonly<{
  delete: <T>(path: string, options?: MiniappApiRequestOptions) => Promise<T>;
  get: <T>(path: string, options?: MiniappApiRequestOptions) => Promise<T>;
  patch: <T>(
    path: string,
    body?: unknown,
    options?: MiniappApiRequestOptions,
  ) => Promise<T>;
  post: <T>(
    path: string,
    body?: unknown,
    options?: MiniappApiRequestOptions,
  ) => Promise<T>;
  put: <T>(
    path: string,
    body?: unknown,
    options?: MiniappApiRequestOptions,
  ) => Promise<T>;
  uploadPresignedPost: (upload: PresignedPostUpload) => Promise<void>;
}> {
  const baseUrl = normalizeBaseUrl(
    dependencies.baseUrl ?? MINIAPP_API_BASE_URL,
  );
  const request = dependencies.request ?? defaultRequest;
  const uploadFile = dependencies.uploadFile ?? defaultUploadFile;

  function sessionForAudience(audience?: ApiAudience) {
    if (audience === 'admin') return dependencies.adminSession.get();
    if (audience === 'customer') return dependencies.customerSession.get();
    return null;
  }

  function clearAudience(
    audience: ApiAudience | undefined,
    requestToken: string | null,
  ): void {
    if (!requestToken) return;
    const currentToken = sessionForAudience(audience)?.accessToken ?? null;
    if (currentToken !== requestToken) return;
    if (audience === 'admin') dependencies.adminSession.clear();
    if (audience === 'customer') dependencies.customerSession.clear();
  }

  function execute<T>(
    method: RequestMethod,
    path: string,
    body: unknown,
    options: MiniappApiRequestOptions = {},
  ): Promise<T> {
    const requestUrl = appendRequestQuery(
      createRequestUrl(baseUrl, path, options.audience),
      options.query,
    );
    const session = sessionForAudience(options.audience);
    const requestBody = normalizeRequestBody(body);
    const header = {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.header,
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    };

    return new Promise<T>((resolve, reject) => {
      request({
        url: requestUrl,
        method: method as WechatMiniprogram.RequestOption['method'],
        timeout: MINIAPP_API_REQUEST_TIMEOUT_MS,
        header,
        ...(requestBody === undefined ? {} : { data: requestBody }),
        success(response) {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(response.data as T);
            return;
          }
          if (response.statusCode === 401) {
            clearAudience(options.audience, session?.accessToken ?? null);
          }
          const payload = readErrorPayload(response.statusCode, response.data);
          reject(
            new ApiClientError(response.statusCode, payload.message, {
              code: payload.code,
              details: payload.details,
              requestId: payload.requestId,
            }),
          );
        },
        fail(error) {
          reject(
            new ApiClientError(0, failureMessage(error), { cause: error }),
          );
        },
      });
    });
  }

  async function uploadPresignedPost(
    upload: PresignedPostUpload,
  ): Promise<void> {
    const uploadUrl = requireSecureUploadUrl(upload.uploadUrl);
    const filePath = parseNonEmptyString(upload.filePath);
    if (!filePath) {
      return Promise.reject(new ApiClientError(0, '头像文件路径无效'));
    }
    await new Promise<void>((resolve, reject) => {
      uploadFile({
        url: uploadUrl,
        filePath,
        name: 'file',
        formData: { ...upload.fields },
        timeout: MINIAPP_API_REQUEST_TIMEOUT_MS,
        success(response) {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }
          reject(
            new ApiClientError(
              response.statusCode,
              `头像上传失败（${response.statusCode}）`,
            ),
          );
        },
        fail(error) {
          reject(
            new ApiClientError(0, failureMessage(error), { cause: error }),
          );
        },
      });
    });
  }

  return {
    delete: <T>(path: string, options?: MiniappApiRequestOptions) =>
      execute<T>('DELETE', path, undefined, options),
    get: <T>(path: string, options?: MiniappApiRequestOptions) =>
      execute<T>('GET', path, undefined, options),
    patch: <T>(
      path: string,
      body?: unknown,
      options?: MiniappApiRequestOptions,
    ) => execute<T>('PATCH', path, body, options),
    post: <T>(
      path: string,
      body?: unknown,
      options?: MiniappApiRequestOptions,
    ) => execute<T>('POST', path, body, options),
    put: <T>(
      path: string,
      body?: unknown,
      options?: MiniappApiRequestOptions,
    ) => execute<T>('PUT', path, body, options),
    uploadPresignedPost,
  };
}
