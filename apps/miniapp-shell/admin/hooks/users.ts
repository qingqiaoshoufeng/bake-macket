import type {
  AdminSessionView,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserView,
} from '@bake-mall/contracts';

import {
  AdminPermission,
  ApiErrorCode,
} from '../../config/contracts.generated.js';
import type { MemorySessionStore } from '../../utils/admin-session.js';
import type { AdminUsersState } from '../type/index.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const PHONE_PATTERN = /^1[3-9]\d{9}$/u;
const API_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  [ApiErrorCode.ADMIN_USER_CONFLICT]: '该手机号已关联用户',
  [ApiErrorCode.ADMIN_PERMISSION_DENIED]: '当前账号无权执行此操作',
};

type UsersDependencies = Readonly<{
  adminSession: MemorySessionStore<AdminSessionView>;
  api: Readonly<{
    create: (phone: string) => Promise<AdminUserView>;
    list: (query: AdminUserListQuery) => Promise<AdminUserListResult>;
  }>;
}>;

function hasPermission(
  session: AdminSessionView | null,
  permission: AdminPermission,
): boolean {
  return Boolean(
    session && session.permissions.some((item) => item === permission),
  );
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return null;
  }
  return typeof error.status === 'number' ? error.status : null;
}

function errorCode(error: unknown): ApiErrorCode | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  return typeof error.code === 'string' &&
    Object.values(ApiErrorCode).includes(error.code as ApiErrorCode)
    ? (error.code as ApiErrorCode)
    : null;
}

function safeError(error: unknown, fallback: string): string {
  if (errorStatus(error) === 401) return '管理员会话已失效，请重新进入';
  const code = errorCode(error);
  return (code && API_MESSAGES[code]) || fallback;
}

function listQuery(
  query: string,
  page: number,
  pageSize: number,
): AdminUserListQuery {
  return {
    ...(query ? { q: query } : {}),
    page,
    pageSize,
  };
}

function cloneState(state: AdminUsersState): AdminUsersState {
  return { ...state, users: state.users.map((user) => ({ ...user })) };
}

export function createUsersController(dependencies: UsersDependencies) {
  let appliedQuery = '';
  let requestGeneration = 0;
  let state: AdminUsersState = {
    canCreate: hasPermission(
      dependencies.adminSession.get(),
      AdminPermission.USER_CREATE,
    ),
    createPhone: '',
    creating: false,
    error: null,
    loading: false,
    page: DEFAULT_PAGE,
    pageSize: DEFAULT_PAGE_SIZE,
    query: '',
    total: 0,
    users: [],
  };

  function snapshot(): AdminUsersState {
    return cloneState(state);
  }

  function setQuery(query: string): void {
    state = { ...state, query };
  }

  function setCreatePhone(createPhone: string): void {
    state = { ...state, createPhone };
  }

  async function refresh(): Promise<void> {
    requestGeneration += 1;
    const requestId = requestGeneration;
    state = { ...state, loading: true, error: null };
    try {
      const result = await dependencies.api.list(
        listQuery(appliedQuery, state.page, state.pageSize),
      );
      if (requestId !== requestGeneration) return;
      state = {
        ...state,
        users: result.items.map((item) => ({ ...item })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      };
    } catch (error) {
      const message = safeError(error, '用户列表加载失败，请稍后重试');
      if (requestId === requestGeneration) {
        if (errorStatus(error) === 401) dependencies.adminSession.clear();
        state = { ...state, error: message };
      }
      throw new Error(message);
    } finally {
      if (requestId === requestGeneration) state = { ...state, loading: false };
    }
  }

  async function search(): Promise<void> {
    appliedQuery = state.query.trim();
    state = { ...state, page: DEFAULT_PAGE };
    await refresh();
  }

  async function setPage(page: number): Promise<void> {
    state = { ...state, page };
    await refresh();
  }

  async function setPageSize(pageSize: number): Promise<void> {
    state = { ...state, page: DEFAULT_PAGE, pageSize };
    await refresh();
  }

  async function createUser(): Promise<AdminUserView> {
    if (!state.canCreate) throw new Error('当前账号无权创建用户');
    if (state.creating) throw new Error('用户正在创建，请勿重复提交');
    const phone = state.createPhone.trim();
    if (!PHONE_PATTERN.test(phone)) {
      state = {
        ...state,
        createPhone: '',
        error: '请输入 11 位中国大陆手机号',
      };
      throw new Error('请输入 11 位中国大陆手机号');
    }

    state = { ...state, creating: true, error: null };
    try {
      const created = await dependencies.api.create(phone);
      appliedQuery = '';
      state = {
        ...state,
        createPhone: '',
        page: DEFAULT_PAGE,
        query: '',
      };
      await refresh();
      return created;
    } catch (error) {
      const message = safeError(error, '用户创建失败，请稍后重试');
      if (errorStatus(error) === 401) dependencies.adminSession.clear();
      state = { ...state, createPhone: '', error: message };
      throw new Error(message);
    } finally {
      state = { ...state, creating: false };
    }
  }

  return {
    createUser,
    refresh,
    search,
    setCreatePhone,
    setPage,
    setPageSize,
    setQuery,
    snapshot,
  } as const;
}
