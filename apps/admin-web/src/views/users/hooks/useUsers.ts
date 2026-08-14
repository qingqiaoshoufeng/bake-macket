import { AdminPermission, ApiErrorCode } from '@bake-mall/contracts';
import { computed, ref, type ComputedRef, type Ref } from 'vue';

import { useAdminAuthStore } from '../../../stores/admin-auth.js';
import { usersApi } from '../api/index.js';
import { USER_PAGINATION, createUserDefaults } from '../config/defaults.js';
import type {
  AdminUserListQuery,
  AdminUserView,
  CreateUserForm,
} from '../type/index.js';

export type UseUsersResult = {
  readonly users: Ref<readonly AdminUserView[]>;
  readonly total: Ref<number>;
  readonly page: Ref<number>;
  readonly pageSize: Ref<number>;
  readonly query: Ref<string>;
  readonly loading: Ref<boolean>;
  readonly lastError: Ref<string | null>;
  readonly lastWarning: Ref<string | null>;
  readonly canCreate: ComputedRef<boolean>;
  readonly createDialogVisible: Ref<boolean>;
  readonly createForm: Ref<CreateUserForm>;
  readonly creating: Ref<boolean>;
  readonly setQuery: (query: string) => void;
  readonly refresh: (options?: {
    readonly reportError?: boolean;
  }) => Promise<void>;
  readonly search: () => Promise<void>;
  readonly setPage: (page: number) => Promise<void>;
  readonly setPageSize: (pageSize: number) => Promise<void>;
  readonly openCreate: () => void;
  readonly closeCreate: () => void;
  readonly setCreatePhone: (phone: string) => void;
  readonly createUser: () => Promise<AdminUserView>;
};

const PHONE_PATTERN = /^1[3-9]\d{9}$/u;
const LOCAL_ERRORS = new Set([
  '当前账号无权创建用户',
  '请输入 11 位中国大陆手机号',
  '用户正在创建，请勿重复提交',
]);
const API_ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  [ApiErrorCode.ADMIN_USER_CONFLICT]: '该手机号已关联用户',
  [ApiErrorCode.ADMIN_PERMISSION_DENIED]: '当前账号无权执行此操作',
};

function errorCode(error: unknown): ApiErrorCode | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' &&
    Object.values(ApiErrorCode).includes(code as ApiErrorCode)
    ? (code as ApiErrorCode)
    : undefined;
}

function safeUsersError(error: unknown, fallback: string): string {
  const code = errorCode(error);
  if (code && API_ERROR_MESSAGES[code]) return API_ERROR_MESSAGES[code];
  return error instanceof Error && LOCAL_ERRORS.has(error.message)
    ? error.message
    : fallback;
}

function listQuery(
  appliedQuery: string,
  page: number,
  pageSize: number,
): AdminUserListQuery {
  return {
    ...(appliedQuery ? { q: appliedQuery } : {}),
    page,
    pageSize,
  };
}

export function useUsers(): UseUsersResult {
  const adminAuth = useAdminAuthStore();
  const users = ref<readonly AdminUserView[]>([]);
  const total = ref(0);
  const page = ref(USER_PAGINATION.defaultPage);
  const pageSize = ref(USER_PAGINATION.defaultPageSize);
  const query = ref('');
  const loading = ref(false);
  const lastError = ref<string | null>(null);
  const lastWarning = ref<string | null>(null);
  const createDialogVisible = ref(false);
  const createForm = ref<CreateUserForm>(createUserDefaults());
  const creating = ref(false);
  const canCreate = computed(() =>
    adminAuth.hasPermission(AdminPermission.USER_CREATE),
  );
  let appliedQuery = '';
  let requestSequence = 0;

  function setQuery(nextQuery: string): void {
    query.value = nextQuery;
  }

  async function refresh(
    options: { readonly reportError?: boolean } = {},
  ): Promise<void> {
    const requestId = ++requestSequence;
    loading.value = true;
    lastError.value = null;
    try {
      const result = await usersApi.list(
        listQuery(appliedQuery, page.value, pageSize.value),
      );
      if (requestId !== requestSequence) return;
      users.value = [...result.items];
      total.value = result.total;
      page.value = result.page;
      pageSize.value = result.pageSize;
    } catch (error) {
      const message = safeUsersError(error, '用户列表加载失败，请稍后重试');
      if (requestId === requestSequence && options.reportError !== false) {
        lastError.value = message;
      }
      throw new Error(message);
    } finally {
      if (requestId === requestSequence) loading.value = false;
    }
  }

  async function search(): Promise<void> {
    appliedQuery = query.value.trim();
    page.value = USER_PAGINATION.defaultPage;
    await refresh();
  }

  async function setPage(nextPage: number): Promise<void> {
    page.value = nextPage;
    await refresh();
  }

  async function setPageSize(nextPageSize: number): Promise<void> {
    pageSize.value = nextPageSize;
    page.value = USER_PAGINATION.defaultPage;
    await refresh();
  }

  function openCreate(): void {
    if (!canCreate.value) return;
    createForm.value = createUserDefaults();
    createDialogVisible.value = true;
  }

  function closeCreate(): void {
    createDialogVisible.value = false;
    createForm.value = createUserDefaults();
  }

  function setCreatePhone(phone: string): void {
    createForm.value = { phone };
  }

  async function createUser(): Promise<AdminUserView> {
    if (!canCreate.value) {
      throw new Error('当前账号无权创建用户');
    }
    if (creating.value) {
      throw new Error('用户正在创建，请勿重复提交');
    }
    const phone = createForm.value.phone.trim();
    if (!PHONE_PATTERN.test(phone)) {
      throw new Error('请输入 11 位中国大陆手机号');
    }

    creating.value = true;
    lastError.value = null;
    lastWarning.value = null;
    try {
      const created = await usersApi.create({ phone });
      query.value = '';
      appliedQuery = '';
      page.value = USER_PAGINATION.defaultPage;
      createDialogVisible.value = false;
      try {
        await refresh({ reportError: false });
      } catch {
        lastError.value = null;
        lastWarning.value = '用户已创建，但列表刷新失败，请手动刷新';
      }
      return created;
    } catch (error) {
      const message = safeUsersError(error, '用户创建失败，请稍后重试');
      lastError.value = message;
      throw new Error(message);
    } finally {
      createForm.value = createUserDefaults();
      creating.value = false;
    }
  }

  return {
    users,
    total,
    page,
    pageSize,
    query,
    loading,
    lastError,
    lastWarning,
    canCreate,
    createDialogVisible,
    createForm,
    creating,
    setQuery,
    refresh,
    search,
    setPage,
    setPageSize,
    openCreate,
    closeCreate,
    setCreatePhone,
    createUser,
  };
}
