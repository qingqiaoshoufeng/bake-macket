import {
  AdminPermission,
  AdminRole,
  OPERATOR_PERMISSIONS,
  type AdminSessionView,
  type AdminUserListResult,
  type AdminUserView,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createAdminSessionStore } from '../../utils/admin-session.js';
import { createUsersController } from './users.js';

const user: AdminUserView = {
  id: 'user-1',
  nickname: '小莓',
  identityPhoneMasked: '138****0000',
  identityPhoneVerified: true,
  wechatBound: true,
  loginPhoneMasked: null,
  createdAt: '2026-08-06T08:00:00.000Z',
  isOperator: false,
  operatorActive: false,
  mustChangePassword: false,
};

const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

function result(
  items: readonly AdminUserView[] = [user],
  page = 1,
  pageSize = 20,
): AdminUserListResult {
  return { items: [...items], total: items.length, page, pageSize };
}

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function usersHarness(session: AdminSessionView = operatorSession) {
  const adminSession = createAdminSessionStore();
  adminSession.set(session);
  const api = {
    create: vi.fn<(phone: string) => Promise<AdminUserView>>(),
    list: vi.fn<
      (query: {
        q?: string;
        page: number;
        pageSize: number;
      }) => Promise<AdminUserListResult>
    >(),
  };
  const controller = createUsersController({ adminSession, api });
  return { adminSession, api, controller };
}

describe('createUsersController', () => {
  it('loads trimmed search and pagination while ignoring an older response', async () => {
    const harness = usersHarness();
    const stale = deferred<AdminUserListResult>();
    const current = deferred<AdminUserListResult>();
    harness.api.list
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    const first = harness.controller.refresh();
    harness.controller.setQuery('  13800000000  ');
    const second = harness.controller.search();
    current.resolve(result([user], 1, 20));
    await second;
    stale.resolve(result([], 3, 50));
    await first;

    expect(harness.api.list).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 20,
    });
    expect(harness.api.list).toHaveBeenNthCalledWith(2, {
      q: '13800000000',
      page: 1,
      pageSize: 20,
    });
    expect(harness.controller.snapshot()).toMatchObject({
      users: [user],
      page: 1,
      pageSize: 20,
      loading: false,
    });
  });

  it('creates a placeholder, resets to page one, and refreshes without a stale filter', async () => {
    const harness = usersHarness();
    const created = {
      ...user,
      id: 'created',
      identityPhoneVerified: false,
    };
    harness.api.create.mockResolvedValue(created);
    harness.api.list.mockResolvedValue(result([created]));
    harness.controller.setQuery('old-filter');
    await harness.controller.search();
    await harness.controller.setPage(4);
    harness.controller.setCreatePhone(' 13900000000 ');

    await expect(harness.controller.createUser()).resolves.toEqual(created);

    expect(harness.api.create).toHaveBeenCalledWith('13900000000');
    expect(harness.api.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
    });
    expect(harness.controller.snapshot()).toMatchObject({
      query: '',
      createPhone: '',
      page: 1,
      creating: false,
    });
  });

  it('does not expose grant/revoke operations and blocks create without USER_CREATE', async () => {
    const readOnlySession = {
      ...operatorSession,
      permissions: [AdminPermission.USER_READ],
    } as unknown as AdminSessionView;
    const harness = usersHarness(readOnlySession);

    expect(harness.controller).not.toHaveProperty('grantOperator');
    expect(harness.controller).not.toHaveProperty('revokeOperator');
    expect(harness.controller.snapshot().canCreate).toBe(false);
    harness.controller.setCreatePhone('13900000000');
    await expect(harness.controller.createUser()).rejects.toThrow(
      '当前账号无权创建用户',
    );
    expect(harness.api.create).not.toHaveBeenCalled();
  });

  it('maps validation and API errors to safe messages without reflecting secrets', async () => {
    const harness = usersHarness();
    harness.controller.setCreatePhone('password=secret');
    await expect(harness.controller.createUser()).rejects.toThrow(
      '请输入 11 位中国大陆手机号',
    );

    harness.controller.setCreatePhone('13900000000');
    harness.api.create.mockRejectedValue({
      code: 'ADMIN_USER_CONFLICT',
      message: 'raw password=secret',
    });
    await expect(harness.controller.createUser()).rejects.toThrow(
      '该手机号已关联用户',
    );
    expect(JSON.stringify(harness.controller.snapshot())).not.toContain(
      'secret',
    );
  });

  it('clears the revoked admin session after a 401 list response', async () => {
    const harness = usersHarness();
    harness.api.list.mockRejectedValue({ status: 401, message: 'raw token' });

    await expect(harness.controller.refresh()).rejects.toThrow(
      '管理员会话已失效，请重新进入',
    );

    expect(harness.adminSession.get()).toBeNull();
    expect(harness.controller.snapshot().error).toBe(
      '管理员会话已失效，请重新进入',
    );
  });
});
