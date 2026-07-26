import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_REQUEST_TIMEOUT_MS, ApiClient, ApiClientError } from './http.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const abortError = (): DOMException =>
  new DOMException('The operation was aborted', 'AbortError');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ApiClient timeout and retry policy', () => {
  it('aborts a request after the shared timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError()), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('/api/v1');

    const request = client.post('/slow', { value: 1 });
    const rejection = expect(request).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 0,
      message: '请求超时，请稍后重试',
    } satisfies Partial<ApiClientError>);
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await rejection;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries a GET once after a network error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('/api/v1');

    await expect(client.get('/catalog')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a regular POST after a retryable server error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'busy' }, 503));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('/api/v1');

    await expect(
      client.post('/me/cart/items', { skuId: 'sku-1', quantity: 2 }),
    ).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not retry 401 or other client errors and preserves unauthorized handling', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('/api/v1');
    const onUnauthorized = vi.fn();
    client.setAccessToken('expired-token');
    client.onUnauthorized(onUnauthorized);

    await expect(client.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('retries order creation once when POST carries a stable Idempotency-Key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'busy' }, 503))
      .mockResolvedValueOnce(jsonResponse({ id: 'order-1' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('/api/v1');

    await expect(
      client.post(
        '/orders',
        { cartItemIds: ['cart-1'] },
        {
          headers: { 'Idempotency-Key': 'stable-order-key' },
        },
      ),
    ).resolves.toEqual({ id: 'order-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get('Idempotency-Key'),
      ),
    ).toEqual(['stable-order-key', 'stable-order-key']);
  });

  it('does not retry when the caller aborts the request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError()), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('/api/v1');

    const request = client.get('/catalog', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ status: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
