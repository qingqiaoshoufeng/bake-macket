import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usersApi } from '../api/index.js';
import type { AdminUserDetailView } from '../type/index.js';
import { useUserDetail } from './useUserDetail.js';

vi.mock('../api/index.js', () => ({
  usersApi: { getOne: vi.fn() },
}));

const api = vi.mocked(usersApi);

function detail(id: string): AdminUserDetailView {
  return {
    id,
    nickname: `用户 ${id}`,
    avatarUrl: null,
    wechat: {
      bound: true,
      openidBound: true,
      unionidBound: false,
      openid: `openid-${id}`,
      unionid: null,
    },
    identityPhone: { masked: null, verified: false },
    account: { isActive: true, mergedIntoUserId: null },
    operator: {
      isOperator: false,
      active: false,
      mustChangePassword: false,
      loginPhoneMasked: null,
    },
    createdAt: '2026-08-06T08:00:00.000Z',
    updatedAt: '2026-08-07T08:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUserDetail', () => {
  it('ignores a stale detail response after switching users', async () => {
    const resolvers: Array<(value: AdminUserDetailView) => void> = [];
    api.getOne.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const state = useUserDetail();

    const first = state.open('1');
    const second = state.open('2');
    resolvers[1]?.(detail('2'));
    await second;
    resolvers[0]?.(detail('1'));
    await first;

    expect(state.detail.value?.id).toBe('2');
  });

  it('invalidates an in-flight request when closed', async () => {
    let resolveRequest: ((value: AdminUserDetailView) => void) | undefined;
    api.getOne.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const state = useUserDetail();

    const request = state.open('1');
    state.close();
    resolveRequest?.(detail('1'));
    await request;

    expect(state.visible.value).toBe(false);
    expect(state.detail.value).toBeNull();
  });

  it('returns a safe error and retries the selected user', async () => {
    api.getOne
      .mockRejectedValueOnce(new Error('server leaked secret'))
      .mockResolvedValueOnce(detail('1'));
    const state = useUserDetail();

    await state.open('1');
    expect(state.error.value).toBe('用户详情加载失败，请稍后重试');
    await state.retry();

    expect(api.getOne).toHaveBeenCalledTimes(2);
    expect(state.detail.value?.id).toBe('1');
    expect(state.error.value).toBeNull();
  });
});
