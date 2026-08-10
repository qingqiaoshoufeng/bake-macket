import { AdminRole, ApiErrorCode } from '@bake-mall/contracts';
import { computed, ref, type ComputedRef, type Ref } from 'vue';

import { useAdminAuthStore } from '../../../stores/admin-auth.js';
import { usersApi } from '../api/index.js';
import {
  createOperatorGrantDefaults,
  createOperatorRevokeDefaults,
} from '../config/defaults.js';
import type {
  AdminUserStatusView,
  AdminUserView,
  OperatorGrantForm,
  OperatorRevokeForm,
} from '../type/index.js';

export type UseOperatorActionsResult = {
  readonly selectedUser: Ref<AdminUserView | null>;
  readonly canManageRoles: ComputedRef<boolean>;
  readonly grantDialogVisible: Ref<boolean>;
  readonly revokeDialogVisible: Ref<boolean>;
  readonly grantForm: Ref<OperatorGrantForm>;
  readonly revokeForm: Ref<OperatorRevokeForm>;
  readonly submitting: Ref<boolean>;
  readonly lastError: Ref<string | null>;
  readonly lastWarning: Ref<string | null>;
  readonly openGrant: (user: AdminUserView) => void;
  readonly closeGrant: () => void;
  readonly replaceGrantForm: (form: OperatorGrantForm) => void;
  readonly grant: () => Promise<AdminUserStatusView>;
  readonly openRevoke: (user: AdminUserView) => void;
  readonly closeRevoke: () => void;
  readonly replaceRevokeForm: (form: OperatorRevokeForm) => void;
  readonly revoke: () => Promise<AdminUserStatusView>;
};

const LOCAL_ERRORS = new Set([
  '仅超级管理员可管理操作员角色',
  '请选择需要授权的用户',
  '请完整填写三个密码字段',
  '两次输入的临时密码不一致',
  '请选择需要撤销角色的用户',
  '请输入当前超级管理员密码',
  '请确认已了解撤销影响',
  '角色操作正在提交，请勿重复操作',
]);
const API_ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  [ApiErrorCode.ADMIN_VERIFICATION_FAILED]: '当前超级管理员密码验证失败',
  [ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED]: '验证尝试过多，请稍后重试',
  [ApiErrorCode.ADMIN_PASSWORD_POLICY_VIOLATION]:
    '临时密码不符合要求，请使用至少 6 位数字',
  [ApiErrorCode.ADMIN_USER_CONFLICT]: '该用户当前状态不允许角色变更',
  [ApiErrorCode.ADMIN_PERMISSION_DENIED]: '仅超级管理员可管理操作员角色',
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

function safeOperatorError(error: unknown, fallback: string): string {
  const code = errorCode(error);
  if (code && API_ERROR_MESSAGES[code]) return API_ERROR_MESSAGES[code];
  return error instanceof Error && LOCAL_ERRORS.has(error.message)
    ? error.message
    : fallback;
}

function validateGrant(form: OperatorGrantForm): void {
  if (
    !form.currentPassword ||
    !form.temporaryPassword ||
    !form.confirmTemporaryPassword
  ) {
    throw new Error('请完整填写三个密码字段');
  }
  if (form.temporaryPassword !== form.confirmTemporaryPassword) {
    throw new Error('两次输入的临时密码不一致');
  }
}

function validateRevoke(form: OperatorRevokeForm): void {
  if (!form.currentPassword) {
    throw new Error('请输入当前超级管理员密码');
  }
  if (!form.acknowledged) {
    throw new Error('请确认已了解撤销影响');
  }
}

export function useOperatorActions(
  refreshUsers: () => Promise<void>,
): UseOperatorActionsResult {
  const adminAuth = useAdminAuthStore();
  const selectedUser = ref<AdminUserView | null>(null);
  const grantDialogVisible = ref(false);
  const revokeDialogVisible = ref(false);
  const grantForm = ref<OperatorGrantForm>(createOperatorGrantDefaults());
  const revokeForm = ref<OperatorRevokeForm>(createOperatorRevokeDefaults());
  const submitting = ref(false);
  const lastError = ref<string | null>(null);
  const lastWarning = ref<string | null>(null);
  const canManageRoles = computed(
    () => adminAuth.role === AdminRole.SUPER_ADMIN,
  );
  let dialogSequence = 0;

  function assertCanManage(): void {
    if (!canManageRoles.value) {
      throw new Error('仅超级管理员可管理操作员角色');
    }
  }

  function assertNotSubmitting(): void {
    if (submitting.value) {
      throw new Error('角色操作正在提交，请勿重复操作');
    }
  }

  function openGrant(user: AdminUserView): void {
    if (!canManageRoles.value) return;
    dialogSequence += 1;
    selectedUser.value = user;
    grantForm.value = createOperatorGrantDefaults();
    revokeDialogVisible.value = false;
    grantDialogVisible.value = true;
    lastError.value = null;
    lastWarning.value = null;
  }

  function closeGrant(): void {
    dialogSequence += 1;
    grantDialogVisible.value = false;
    grantForm.value = createOperatorGrantDefaults();
  }

  function replaceGrantForm(form: OperatorGrantForm): void {
    grantForm.value = { ...form };
  }

  async function grant(): Promise<AdminUserStatusView> {
    assertCanManage();
    assertNotSubmitting();
    const user = selectedUser.value;
    if (!user) throw new Error('请选择需要授权的用户');
    const request = { ...grantForm.value };
    const operationSequence = dialogSequence;
    submitting.value = true;
    lastError.value = null;
    lastWarning.value = null;
    try {
      validateGrant(request);
      const status = await usersApi.grantOperator(user.id, request);
      if (
        dialogSequence === operationSequence &&
        selectedUser.value?.id === user.id
      ) {
        grantDialogVisible.value = false;
        selectedUser.value = null;
      }
      try {
        await refreshUsers();
      } catch {
        if (dialogSequence === operationSequence) {
          lastError.value = null;
          lastWarning.value = '操作员已授权，但用户列表刷新失败，请手动刷新';
        }
      }
      return status;
    } catch (error) {
      const message = safeOperatorError(error, '操作员授权失败，请稍后重试');
      if (dialogSequence === operationSequence) lastError.value = message;
      throw new Error(message);
    } finally {
      if (dialogSequence === operationSequence) {
        grantForm.value = createOperatorGrantDefaults();
      }
      submitting.value = false;
    }
  }

  function openRevoke(user: AdminUserView): void {
    if (!canManageRoles.value) return;
    dialogSequence += 1;
    selectedUser.value = user;
    revokeForm.value = createOperatorRevokeDefaults();
    grantDialogVisible.value = false;
    revokeDialogVisible.value = true;
    lastError.value = null;
    lastWarning.value = null;
  }

  function closeRevoke(): void {
    dialogSequence += 1;
    revokeDialogVisible.value = false;
    revokeForm.value = createOperatorRevokeDefaults();
  }

  function replaceRevokeForm(form: OperatorRevokeForm): void {
    revokeForm.value = { ...form };
  }

  async function revoke(): Promise<AdminUserStatusView> {
    assertCanManage();
    assertNotSubmitting();
    const user = selectedUser.value;
    if (!user) throw new Error('请选择需要撤销角色的用户');
    const form = { ...revokeForm.value };
    const operationSequence = dialogSequence;
    submitting.value = true;
    lastError.value = null;
    lastWarning.value = null;
    try {
      validateRevoke(form);
      const status = await usersApi.revokeOperator(user.id, {
        currentPassword: form.currentPassword,
      });
      if (
        dialogSequence === operationSequence &&
        selectedUser.value?.id === user.id
      ) {
        revokeDialogVisible.value = false;
        selectedUser.value = null;
      }
      try {
        await refreshUsers();
      } catch {
        if (dialogSequence === operationSequence) {
          lastError.value = null;
          lastWarning.value =
            '操作员角色已撤销，但用户列表刷新失败，请手动刷新';
        }
      }
      return status;
    } catch (error) {
      const message = safeOperatorError(error, '角色撤销失败，请稍后重试');
      if (dialogSequence === operationSequence) lastError.value = message;
      throw new Error(message);
    } finally {
      if (dialogSequence === operationSequence) {
        revokeForm.value = createOperatorRevokeDefaults();
      }
      submitting.value = false;
    }
  }

  return {
    selectedUser,
    canManageRoles,
    grantDialogVisible,
    revokeDialogVisible,
    grantForm,
    revokeForm,
    submitting,
    lastError,
    lastWarning,
    openGrant,
    closeGrant,
    replaceGrantForm,
    grant,
    openRevoke,
    closeRevoke,
    replaceRevokeForm,
    revoke,
  };
}
