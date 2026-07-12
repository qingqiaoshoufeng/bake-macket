import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import { useAdminAuthStore } from './admin-auth.js';

/**
 * Admin auth-store contract pinned by Task 11.
 *
 * - `requireAdminAuth(path)` returns a `/login?redirect=<encoded path>`
 *   target whenever the admin is unauthenticated; the consumer is a router
 *   navigation guard that must keep protected admin routes safe.
 * - `loginAsAdmin(email, password)` POSTs to `/admin/auth/login`, persists
 *   the issued token and clears the previous profile, and routes the
 *   request through the shared `ApiClient` so 401 handling stays uniform.
 */

describe('useAdminAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the login redirect when no admin session is present', () => {
    const store = useAdminAuthStore();
    expect(store.requireAdminAuth('/products')).toBe(
      '/login?redirect=%2Fproducts',
    );
  });

  it('returns null once an admin session is established', () => {
    const store = useAdminAuthStore();
    store.accessToken = 'admin-token-1';
    expect(store.requireAdminAuth('/orders')).toBeNull();
  });

  it('persists the issued token after a successful login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: 'admin-token-1',
          expiresAt: '2026-07-12T01:00:00.000Z',
          profile: { email: 'admin@example.test', displayName: 'Admin' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = useAdminAuthStore();
    await store.loginAsAdmin('admin@example.test', 'admin-password');

    expect(store.accessToken).toBe('admin-token-1');
    expect(store.profile).toEqual({
      email: 'admin@example.test',
      displayName: 'Admin',
    });
    expect(window.sessionStorage.getItem('bake_admin_token')).toBe(
      'admin-token-1',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/admin/auth/login');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'admin@example.test',
      password: 'admin-password',
    });
  });
});
