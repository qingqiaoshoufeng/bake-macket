import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { customerApi } from '../api/customer.js';
import { useAuthStore } from './auth.js';
import { useProfileRefreshStore } from './profile-refresh.js';

vi.mock('../api/customer.js', () => ({
  customerApi: { getMe: vi.fn() },
}));

describe('useProfileRefreshStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(customerApi.getMe).mockReset();
  });

  it('refreshes through the H5 bearer client and applies the mapped profile', async () => {
    vi.mocked(customerApi.getMe).mockResolvedValueOnce({
      id: 'user-1',
      nickname: '新昵称',
      avatarUrl: 'https://objects.example.com/avatar.png',
      phone: null,
      phoneVerified: false,
      profileCompleted: true,
      orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
    });
    const auth = useAuthStore();
    const refresh = useProfileRefreshStore();

    await expect(refresh.refresh()).resolves.toBe(true);

    expect(customerApi.getMe).toHaveBeenCalledWith();
    expect(auth.profile).toMatchObject({
      id: 'user-1',
      nickname: '新昵称',
      profileCompleted: true,
    });
    expect(refresh.status).toBe('idle');
  });

  it('ignores a successful stale response after the H5 session changes', async () => {
    let resolveProfile:
      | ((profile: Awaited<ReturnType<typeof customerApi.getMe>>) => void)
      | undefined;
    vi.mocked(customerApi.getMe).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve;
        }),
    );
    const auth = useAuthStore();
    auth.applySession(
      { accessToken: 'user-a-token', expiresAt: '2026-08-19T00:00:00.000Z' },
      {
        id: 'user-a',
        phoneVerified: false,
        profileCompleted: false,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      },
    );
    const refresh = useProfileRefreshStore();
    const pending = refresh.refresh();

    auth.applySession(
      { accessToken: 'user-b-token', expiresAt: '2026-08-19T00:00:00.000Z' },
      {
        id: 'user-b',
        nickname: '用户 B',
        phoneVerified: false,
        profileCompleted: true,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      },
    );
    resolveProfile?.({
      id: 'user-a',
      nickname: '用户 A',
      avatarUrl: null,
      phone: null,
      phoneVerified: false,
      profileCompleted: false,
      orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
    });

    await expect(pending).resolves.toBe(false);
    expect(auth.profile?.id).toBe('user-b');
    expect(refresh.status).toBe('idle');
  });

  it('exposes a user-retryable failure without clearing the session or looping', async () => {
    vi.mocked(customerApi.getMe)
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce({
        id: 'user-1',
        nickname: '重试成功',
        avatarUrl: null,
        phone: null,
        phoneVerified: false,
        profileCompleted: false,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      });
    const auth = useAuthStore();
    auth.applySession(
      { accessToken: 'h5-token', expiresAt: '2026-08-19T00:00:00.000Z' },
      {
        id: 'user-1',
        phoneVerified: false,
        orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
      },
    );
    const refresh = useProfileRefreshStore();

    await expect(refresh.refresh()).resolves.toBe(false);
    expect(refresh.status).toBe('failed');
    expect(refresh.error).toBe('资料刷新失败，请重试');
    expect(auth.accessToken).toBe('h5-token');
    expect(customerApi.getMe).toHaveBeenCalledOnce();

    await expect(refresh.retry()).resolves.toBe(true);
    expect(customerApi.getMe).toHaveBeenCalledTimes(2);
    expect(refresh.status).toBe('idle');
  });
});
