import {
  AdminPermission,
  AdminRole,
  OPERATOR_PERMISSIONS,
  type AdminSessionView,
  type AdminUserListResult,
  type AdminUserView,
} from '@bake-mall/contracts';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAdminAuthStore } from '../../../stores/admin-auth.js';
import { usersApi } from '../api/index.js';
import { useUsers } from './useUsers.js';

vi.mock('../api/index.js', () => ({
  usersApi: {
    list: vi.fn(),
    create: vi.fn(),
    grantOperator: vi.fn(),
    revokeOperator: vi.fn(),
  },
}));

const api = vi.mocked(usersApi);
const user: AdminUserView = {
  id: 'user-1',
  nickname: '小莓',
  phoneMasked: '138****0000',
  phoneVerified: true,
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

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  const resolve = vi.fn<(value: T) => void>();
  const promise = new Promise<T>((promiseResolve) => {
    resolve.mockImplementation(promiseResolve);
  });
  return { promise, resolve };
}

beforeEach(() => {
  setActivePinia(createPinia());
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe('useUsers', () => {
  it('loads q/page/pageSize and ignores an older response that resolves last', async () => {
    const stale = deferred<AdminUserListResult>();
    const current = deferred<AdminUserListResult>();
    api.list
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const state = useUsers();

    const first = state.refresh();
    state.setQuery('  13800000000  ');
    const second = state.search();
    current.resolve(result([user], 1, 20));
    await second;
    stale.resolve(result([], 3, 50));
    await first;

    expect(api.list).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 20 });
    expect(api.list).toHaveBeenNthCalledWith(2, {
      q: '13800000000',
      page: 1,
      pageSize: 20,
    });
    expect(state.users.value).toEqual([user]);
    expect(state.page.value).toBe(1);
    expect(state.pageSize.value).toBe(20);
  });

  it('can reject a mutation refresh without publishing a list error', async () => {
    api.list.mockRejectedValue(new Error('network details'));
    const state = useUsers();

    await expect(state.refresh({ reportError: false })).rejects.toThrow(
      '用户列表加载失败，请稍后重试',
    );

    expect(state.lastError.value).toBeNull();
  });

  it('changes page and pageSize using the applied query', async () => {
    api.list.mockImplementation((query) =>
      Promise.resolve(result([user], query.page, query.pageSize)),
    );
    const state = useUsers();
    state.setQuery('小莓');
    await state.search();
    await state.setPage(3);
    await state.setPageSize(50);

    expect(api.list).toHaveBeenNthCalledWith(2, {
      q: '小莓',
      page: 3,
      pageSize: 20,
    });
    expect(api.list).toHaveBeenNthCalledWith(3, {
      q: '小莓',
      page: 1,
      pageSize: 50,
    });
  });

  it('creates a placeholder by phone and refreshes page one without a stale filter', async () => {
    const created = { ...user, id: 'user-created', phoneVerified: false };
    api.list.mockResolvedValue(result([created], 1, 20));
    api.create.mockResolvedValue(created);
    const auth = useAdminAuthStore();
    auth.applySession(operatorSession, { identifier: '13800000000' });
    const state = useUsers();
    state.setQuery('old-filter');
    await state.search();
    await state.setPage(4);
    state.openCreate();
    state.setCreatePhone(' 13900000000 ');

    await expect(state.createUser()).resolves.toEqual(created);

    expect(api.create).toHaveBeenCalledWith({ phone: '13900000000' });
    expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(state.query.value).toBe('');
    expect(state.page.value).toBe(1);
    expect(state.createForm.value.phone).toBe('');
    expect(state.createDialogVisible.value).toBe(false);
    expect(state.canCreate.value).toBe(true);
  });

  it('reports a refresh warning without turning a successful creation into a failure', async () => {
    const created = { ...user, id: 'user-created', phoneVerified: false };
    api.create.mockResolvedValue(created);
    api.list.mockRejectedValue(new Error('network details'));
    const auth = useAdminAuthStore();
    auth.applySession(operatorSession, { identifier: '13800000000' });
    const state = useUsers();
    state.openCreate();
    state.setCreatePhone('13900000000');

    await expect(state.createUser()).resolves.toEqual(created);

    expect(api.create).toHaveBeenCalledOnce();
    expect(state.createDialogVisible.value).toBe(false);
    expect(state.lastError.value).toBeNull();
    expect(state.lastWarning.value).toBe(
      '用户已创建，但列表刷新失败，请手动刷新',
    );
  });

  it('calls the create API only once while a creation is pending', async () => {
    const pendingCreate = deferred<AdminUserView>();
    const created = { ...user, id: 'user-created', phoneVerified: false };
    api.create.mockReturnValue(pendingCreate.promise);
    api.list.mockResolvedValue(result([created]));
    const auth = useAdminAuthStore();
    auth.applySession(operatorSession, { identifier: '13800000000' });
    const state = useUsers();
    state.openCreate();
    state.setCreatePhone('13900000000');

    const pending = state.createUser();
    await expect(state.createUser()).rejects.toThrow(
      '用户正在创建，请勿重复提交',
    );
    expect(state.creating.value).toBe(true);
    expect(api.create).toHaveBeenCalledOnce();

    pendingCreate.resolve(created);
    await expect(pending).resolves.toEqual(created);
    expect(state.creating.value).toBe(false);
  });

  it('does not expose or execute creation without USER_CREATE', async () => {
    const auth = useAdminAuthStore();
    auth.applySession(
      {
        ...operatorSession,
        permissions: [AdminPermission.USER_READ],
      } as unknown as AdminSessionView,
      { identifier: '13800000000' },
    );
    const state = useUsers();

    expect(state.canCreate.value).toBe(false);
    state.openCreate();
    state.setCreatePhone('13900000000');
    await expect(state.createUser()).rejects.toThrow('当前账号无权创建用户');
    expect(state.createDialogVisible.value).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('uses safe local validation and error-code messages without reflecting raw server text', async () => {
    const auth = useAdminAuthStore();
    auth.applySession(operatorSession, { identifier: '13800000000' });
    const state = useUsers();
    state.openCreate();
    state.setCreatePhone('password=secret');

    await expect(state.createUser()).rejects.toThrow(
      '请输入 11 位中国大陆手机号',
    );
    expect(api.create).not.toHaveBeenCalled();

    state.setCreatePhone('13900000000');
    api.create.mockRejectedValueOnce({
      code: 'ADMIN_USER_CONFLICT',
      message: 'raw password=secret',
    });
    await expect(state.createUser()).rejects.toThrow('该手机号已关联用户');
    expect(state.lastError.value).toBe('该手机号已关联用户');
    expect(state.lastError.value).not.toContain('secret');
  });
});
