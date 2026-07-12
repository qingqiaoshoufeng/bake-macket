import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import { useAuthStore } from './auth.js';

/**
 * Pinia auth-store contract pinned by Task 8.
 *
 * - `requireVerifiedPhone(path)` returns a `/login?redirect=<encoded path>`
 *   target whenever the user lacks a verified phone; the consumer is a
 *   router navigation guard that should never re-checkout when the user is
 *   anonymous or unverified.
 * - `loginWithDevelopmentCode(phone, code)` must persist the issued token in
 *   the store so subsequent requests carry the user JWT. The phone round-trips
 *   back into `profile.phone` because the dev login flow treats the phone as
 *   already verified by the fixed `123456` development code (see API
 *   `POST /api/v1/auth/dev/login`).
 */

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the login redirect when the verified phone is absent', () => {
    const store = useAuthStore();
    store.profile = {
      id: 'u1',
      phone: undefined,
      nickname: 'Cake Fan',
      avatarUrl: undefined,
      phoneVerified: false,
    };
    expect(store.requireVerifiedPhone('/checkout')).toBe(
      '/login?redirect=%2Fcheckout',
    );
  });

  it('returns null when the verified phone is present', () => {
    const store = useAuthStore();
    store.profile = {
      id: 'u1',
      phone: '13800000000',
      nickname: 'Cake Fan',
      avatarUrl: undefined,
      phoneVerified: true,
    };
    expect(store.requireVerifiedPhone('/checkout')).toBeNull();
  });

  it('persists the issued token after a successful development login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: 'user-token-1',
          expiresAt: '2026-07-12T01:00:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = useAuthStore();
    await store.loginWithDevelopmentCode('13800000000', '123456');

    expect(store.accessToken).toBe('user-token-1');
    expect(store.profile?.phone).toBe('13800000000');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/auth/dev/login');
    expect(JSON.parse(init.body as string)).toEqual({
      phone: '13800000000',
      code: '123456',
    });
  });
});
