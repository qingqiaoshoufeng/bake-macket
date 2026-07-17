import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from './http.js';

describe('ApiClient.put', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
