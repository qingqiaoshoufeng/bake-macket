import { describe, expect, it, vi } from 'vitest';

import { loginAsAdmin } from './index.js';

describe('login api', () => {
  it('posts credentials through the global api client endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: 'admin-token-1',
          expiresAt: '2026-07-19T12:00:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await loginAsAdmin({
      email: 'admin@example.com',
      password: 'admin-password',
    });

    expect(response.accessToken).toBe('admin-token-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/admin/auth/login');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'admin@example.com',
      password: 'admin-password',
    });
  });
});
