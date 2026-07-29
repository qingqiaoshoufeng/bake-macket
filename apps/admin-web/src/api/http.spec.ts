import { ApiErrorCode } from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiClientError } from './http.js';

function blobResponse(
  body: BlobPart,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      ...headers,
    },
  });
}

function jsonErrorResponse(
  body: unknown,
  status: number,
  statusText = '',
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ApiClient.put', () => {
  it('sends a JSON PUT request while preserving caller headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'product-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('/api/v1');

    await client.put(
      '/admin/products/1',
      { name: '蛋糕' },
      {
        method: 'POST',
        headers: { 'x-request-id': 'request-1' },
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);

    expect(url).toBe('/api/v1/admin/products/1');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ name: '蛋糕' }));
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-request-id')).toBe('request-1');
  });
});

describe('ApiClient.getBlob', () => {
  it('uses the base URL and bearer token, then returns the blob MIME type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      blobResponse('orders', {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('/api/v1/');
    client.setAccessToken('admin-token');

    const downloaded = await client.getBlob('/admin/orders/export');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/orders/export');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer admin-token',
    );
    expect(downloaded.blob).toBeInstanceOf(Blob);
    expect(downloaded.blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('prefers and decodes a UTF-8 filename-star parameter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        blobResponse('orders', {
          'content-disposition':
            `attachment; filename="orders.xlsx"; filename*=UTF-8''%E8%AE%A2%E5%8D%95.xlsx`,
        }),
      ),
    );

    const downloaded = await new ApiClient().getBlob('/admin/orders/export');

    expect(downloaded.filename).toBe('订单.xlsx');
  });

  it.each([
    ['attachment; filename="orders.xlsx"', 'orders.xlsx'],
    ['attachment; filename=orders.xlsx', 'orders.xlsx'],
  ])('parses a regular filename from %s', async (disposition, expected) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          blobResponse('orders', { 'content-disposition': disposition }),
        ),
    );

    const downloaded = await new ApiClient().getBlob('/admin/orders/export');

    expect(downloaded.filename).toBe(expected);
  });

  it.each([
    `attachment; filename*=UTF-8''%E0%A4%A`,
    'attachment; filename="../orders.xlsx"',
    'attachment; filename="..\\orders.xlsx"',
  ])(
    'returns no filename for malformed or unsafe disposition %s without failing the download',
    async (disposition) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            blobResponse('orders', { 'content-disposition': disposition }),
          ),
      );

      await expect(
        new ApiClient().getBlob('/admin/orders/export'),
      ).resolves.toMatchObject({ filename: undefined });
    },
  );

  it('clears the token and invokes the unauthorized handler on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonErrorResponse({ code: 'UNAUTHORIZED', message: '登录已过期' }, 401),
      )
      .mockResolvedValueOnce(blobResponse('orders'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    const unauthorizedHandler = vi.fn();
    client.setAccessToken('expired-token');
    client.onUnauthorized(unauthorizedHandler);

    await expect(client.getBlob('/admin/orders/export')).rejects.toMatchObject({
      status: 401,
      message: '登录已过期',
    } satisfies Partial<ApiClientError>);
    expect(unauthorizedHandler).toHaveBeenCalledWith(window.location.pathname);

    await client.getBlob('/admin/orders/export');
    const [, retryInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new Headers(retryInit.headers).has('Authorization')).toBe(false);
  });

  it('falls back to a regular filename when filename-star is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        blobResponse('orders', {
          'content-disposition':
            `attachment; filename="orders.xlsx"; filename*=UTF-8''%E0%A4%A`,
        }),
      ),
    );

    const downloaded = await new ApiClient().getBlob('/admin/orders/export');

    expect(downloaded.filename).toBe('orders.xlsx');
  });

  it('always preserves a non-2xx JSON ApiError instead of returning an empty file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonErrorResponse(
          {
            code: ApiErrorCode.EXPORT_TOO_LARGE,
            message: '导出记录过多',
            details: { maxRows: 10_000 },
            requestId: 'request-export-1',
          },
          422,
        ),
      ),
    );

    await expect(
      new ApiClient().getBlob('/admin/orders/export', {
        // @ts-expect-error Blob 下载不允许关闭错误抛出。
        throwOnError: false,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: ApiErrorCode.EXPORT_TOO_LARGE,
      message: '导出记录过多',
      details: { maxRows: 10_000 },
      requestId: 'request-export-1',
    } satisfies Partial<ApiClientError>);
  });

  it('normalizes network failures like JSON requests', async () => {
    const cause = new TypeError('network down');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));

    await expect(
      new ApiClient().getBlob('/admin/orders/export'),
    ).rejects.toMatchObject({
      status: 0,
      message: '网络异常,请稍后重试',
      cause,
    } satisfies Partial<ApiClientError>);
  });
});
