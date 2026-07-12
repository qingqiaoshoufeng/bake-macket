import type { ApiError } from '@bake-mall/contracts';

/**
 * Typed wrapper around the backend `ApiError` payload.
 *
 * `response.json()` from `fetch` returns `any`; raising it as
 * `ApiClientError` lets callers narrow on `code` / `message` / `details`
 * without sprinkling type guards through every component. The cause carries
 * the original response for callers that need to inspect status, headers,
 * or fallback payloads.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: ApiError['code'];
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  readonly cause?: unknown;

  constructor(
    status: number,
    message: string,
    options: {
      code?: ApiError['code'];
      details?: Record<string, unknown>;
      requestId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
    this.cause = options.cause;
  }

  /**
   * Convert the error to the wire-shape {@link ApiError} so callers that
   * already speak the contract can forward it to logs / analytics. Network
   * and parse failures don't carry a server-issued code, so the result is a
   * partial shape; callers that need a guaranteed `code` should branch on
   * `status` first.
   */
  toApiError(): Partial<ApiError> {
    return {
      ...(this.code ? { code: this.code } : {}),
      message: this.message,
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export type ApiRequestInit = Omit<RequestInit, 'body'> & {
  body?: unknown;
  /** Bearer token override; falls back to the auth store token. */
  token?: string | null;
  /**
   * When `true`, an `ApiClientError` is raised with the upstream payload even
   * for non-2xx responses. Defaults to `true` so all error handling routes
   * through {@link ApiClientError}.
   */
  throwOnError?: boolean;
};

export type UnauthorizedHandler = (path: string) => void;

const DEFAULT_API_BASE = '/api/v1';

/**
 * Pull the JSON body out of a fetch `Response` while normalising error
 * shapes. The backend returns the `ApiError` envelope for non-2xx responses;
 * unparseable bodies fall back to `statusText` so callers always have a
 * string `message`. Returns only the optional fields; the caller composes a
 * typed {@link ApiError} when it actually needs to surface one.
 */
async function readErrorPayload(response: Response): Promise<{
  code?: ApiError['code'];
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}> {
  const fallbackMessage =
    response.statusText || `Request failed with status ${response.status}`;
  const raw = await response.text().catch(() => '');
  if (!raw) return { message: fallbackMessage };
  try {
    const parsed = JSON.parse(raw) as Partial<ApiError> & { message?: string };
    return {
      message: parsed.message ?? fallbackMessage,
      ...(parsed.code ? { code: parsed.code } : {}),
      ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
      ...(parsed.details ? { details: parsed.details } : {}),
    };
  } catch {
    return { message: raw.slice(0, 500) || fallbackMessage };
  }
}

/**
 * Build a single shared `fetch` wrapper for the storefront. The wrapper:
 *
 * - prefixes every request with the configurable API base;
 * - serialises JSON bodies and sets the matching `content-type`;
 * - forwards the caller-supplied (or store-supplied) bearer token;
 * - converts failures to {@link ApiClientError} so components can `instanceof`
 *   -check without parsing `response.json()` themselves;
 * - on a `401`, invokes the registered unauthorized handler so the auth
 *   store can clear its session and the router can bounce the user to
 *   `/login?redirect=…` before any further requests fire.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private token: string | null = null;
  private unauthorizedHandler: UnauthorizedHandler | null = null;

  constructor(baseUrl: string = DEFAULT_API_BASE) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setAccessToken(token: string | null): void {
    this.token = token;
  }

  onUnauthorized(handler: UnauthorizedHandler | null): void {
    this.unauthorizedHandler = handler;
  }

  async request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const { body, token, throwOnError = true, headers, ...rest } = init;
    const url = this.resolve(path);
    const requestHeaders = new Headers(headers ?? {});
    const bearerToken = token ?? this.token;
    if (bearerToken) {
      requestHeaders.set('Authorization', `Bearer ${bearerToken}`);
    }

    let bodyPayload: BodyInit | undefined;
    if (body === undefined || body === null) {
      bodyPayload = undefined;
    } else if (typeof body === 'string' || body instanceof FormData) {
      bodyPayload = body;
    } else {
      bodyPayload = JSON.stringify(body);
      if (!requestHeaders.has('content-type')) {
        requestHeaders.set('content-type', 'application/json');
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...rest,
        headers: requestHeaders,
        body: bodyPayload,
      });
    } catch (networkError) {
      throw new ApiClientError(0, '网络异常,请稍后重试', {
        cause: networkError,
      });
    }

    if (!response.ok) {
      const payload = await readErrorPayload(response);
      const error = new ApiClientError(response.status, payload.message, {
        code: payload.code,
        details: payload.details,
        requestId: payload.requestId,
      });
      if (response.status === 401) {
        this.token = null;
        this.unauthorizedHandler?.(
          typeof window === 'undefined' ? '/' : window.location.pathname,
        );
      }
      if (throwOnError) {
        throw error;
      }
      return undefined as T;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  get<T>(path: string, init?: ApiRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'POST', body });
  }

  patch<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'PATCH', body });
  }

  delete<T>(path: string, init?: ApiRequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'DELETE' });
  }

  private resolve(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const prefix = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${prefix}`;
  }
}

/**
 * Module-level default client. Components import `apiClient` so the auth
 * store can register its unauthorized handler exactly once at app boot.
 */
export const apiClient = new ApiClient();
