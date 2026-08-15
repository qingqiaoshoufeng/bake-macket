import {
  AdminRole,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  type AdminSessionView,
  type AdminUserStatusView,
  type AdminUserView,
} from '@bake-mall/contracts';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAdminAuthStore } from '../../../stores/admin-auth.js';
import { usersApi } from '../api/index.js';
import { useOperatorActions } from './useOperatorActions.js';

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
  identityPhoneMasked: '138****0000',
  identityPhoneVerified: true,
  wechatBound: true,
  loginPhoneMasked: null,
  createdAt: '2026-08-06T08:00:00.000Z',
  isOperator: false,
  operatorActive: false,
  mustChangePassword: false,
};
const granted: AdminUserStatusView = {
  userId: user.id,
  operator: {
    adminUserId: 'admin-1',
    role: AdminRole.OPERATOR,
    isActive: true,
    mustChangePassword: true,
  },
};
const superSession: AdminSessionView = {
  accessToken: 'super-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  role: AdminRole.SUPER_ADMIN,
  permissions: SUPER_ADMIN_PERMISSIONS,
  mustChangePassword: false,
};
const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

function activate(session: AdminSessionView): void {
  useAdminAuthStore().applySession(session, { identifier: 'admin' });
}

beforeEach(() => {
  setActivePinia(createPinia());
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe('useOperatorActions', () => {
  it('allows only SUPER_ADMIN to manage roles even when OPERATOR has the same permissions', async () => {
    activate(operatorSession);
    const actions = useOperatorActions(vi.fn());

    expect(actions.canManageRoles.value).toBe(false);
    actions.openGrant(user);
    expect(actions.grantDialogVisible.value).toBe(false);
    await expect(actions.grant()).rejects.toThrow(
      '仅超级管理员可管理操作员角色',
    );
    await expect(actions.revoke()).rejects.toThrow(
      '仅超级管理员可管理操作员角色',
    );
    expect(api.grantOperator).not.toHaveBeenCalled();
    expect(api.revokeOperator).not.toHaveBeenCalled();
  });

  it('maps the three-field grant contract, refreshes, and clears every password', async () => {
    activate(superSession);
    const refresh = vi.fn().mockResolvedValue(undefined);
    api.grantOperator.mockResolvedValue(granted);
    const actions = useOperatorActions(refresh);
    actions.openGrant(user);
    actions.replaceGrantForm({
      loginPhone: '13700000000',
      currentPassword: 'super-secret',
      temporaryPassword: 'operator-secret',
      confirmTemporaryPassword: 'operator-secret',
    });

    await expect(actions.grant()).resolves.toEqual(granted);

    expect(api.grantOperator).toHaveBeenCalledWith(user.id, {
      loginPhone: '13700000000',
      currentPassword: 'super-secret',
      temporaryPassword: 'operator-secret',
      confirmTemporaryPassword: 'operator-secret',
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(actions.grantForm.value).toEqual({
      loginPhone: '',
      currentPassword: '',
      temporaryPassword: '',
      confirmTemporaryPassword: '',
    });
    expect(actions.grantDialogVisible.value).toBe(false);
  });

  it('拒绝未绑定微信的用户和非法管理员登录手机号', async () => {
    activate(superSession);
    const actions = useOperatorActions(vi.fn());
    actions.openGrant({ ...user, wechatBound: false });
    expect(actions.grantDialogVisible.value).toBe(false);
    expect(actions.lastError.value).toBe('仅可授权已绑定微信的用户');

    actions.openGrant(user);
    actions.replaceGrantForm({
      loginPhone: '1380000000',
      currentPassword: 'super-secret',
      temporaryPassword: '123456',
      confirmTemporaryPassword: '123456',
    });
    await expect(actions.grant()).rejects.toThrow(
      '请输入 11 位中国大陆管理员登录手机号',
    );
    expect(api.grantOperator).not.toHaveBeenCalled();
  });

  it('将独立管理员登录手机号冲突映射为安全文案', async () => {
    activate(superSession);
    const actions = useOperatorActions(vi.fn());
    actions.openGrant(user);
    actions.replaceGrantForm({
      loginPhone: '13700000000',
      currentPassword: 'super-secret',
      temporaryPassword: '123456',
      confirmTemporaryPassword: '123456',
    });
    api.grantOperator.mockRejectedValueOnce({
      code: 'ADMIN_LOGIN_PHONE_CONFLICT',
      message: 'raw 13700000000',
    });

    await expect(actions.grant()).rejects.toThrow('该管理员登录手机号已被使用');
    expect(actions.lastError.value).toBe('该管理员登录手机号已被使用');
    expect(actions.lastError.value).not.toContain('13700000000');
  });

  it('reports a refresh warning without turning a successful grant into a failure', async () => {
    activate(superSession);
    const refresh = vi.fn().mockRejectedValue(new Error('network details'));
    api.grantOperator.mockResolvedValue(granted);
    const actions = useOperatorActions(refresh);
    actions.openGrant(user);
    actions.replaceGrantForm({
      loginPhone: '13700000000',
      currentPassword: 'super-secret',
      temporaryPassword: 'operator-secret',
      confirmTemporaryPassword: 'operator-secret',
    });

    await expect(actions.grant()).resolves.toEqual(granted);

    expect(actions.grantDialogVisible.value).toBe(false);
    expect(actions.lastError.value).toBeNull();
    expect(actions.lastWarning.value).toBe(
      '操作员已授权，但用户列表刷新失败，请手动刷新',
    );
  });

  it('clears all grant passwords after local validation or request failure and hides raw errors', async () => {
    activate(superSession);
    const actions = useOperatorActions(vi.fn());
    actions.openGrant(user);
    actions.replaceGrantForm({
      loginPhone: '13700000000',
      currentPassword: 'super-secret',
      temporaryPassword: 'operator-secret',
      confirmTemporaryPassword: 'different-secret',
    });

    await expect(actions.grant()).rejects.toThrow('两次输入的临时密码不一致');
    expect(api.grantOperator).not.toHaveBeenCalled();
    expect(actions.grantForm.value.currentPassword).toBe('');
    expect(actions.grantForm.value.temporaryPassword).toBe('');
    expect(actions.grantForm.value.confirmTemporaryPassword).toBe('');

    actions.replaceGrantForm({
      loginPhone: '13700000000',
      currentPassword: 'super-secret',
      temporaryPassword: 'operator-secret',
      confirmTemporaryPassword: 'operator-secret',
    });
    api.grantOperator.mockRejectedValueOnce({
      code: 'ADMIN_VERIFICATION_FAILED',
      message: 'raw super-secret operator-secret',
    });
    await expect(actions.grant()).rejects.toThrow('当前超级管理员密码验证失败');
    expect(actions.lastError.value).toBe('当前超级管理员密码验证失败');
    expect(actions.lastError.value).not.toContain('secret');
    expect(actions.grantForm.value.currentPassword).toBe('');
  });

  it('maps revoke verification, refreshes, clears its password, and requires acknowledgement', async () => {
    activate(superSession);
    const refresh = vi.fn().mockResolvedValue(undefined);
    api.revokeOperator.mockResolvedValue({ userId: user.id, operator: null });
    const actions = useOperatorActions(refresh);
    actions.openRevoke({ ...user, isOperator: true, operatorActive: true });
    actions.replaceRevokeForm({
      currentPassword: 'super-secret',
      acknowledged: false,
    });

    await expect(actions.revoke()).rejects.toThrow('请确认已了解撤销影响');
    expect(api.revokeOperator).not.toHaveBeenCalled();
    expect(actions.revokeForm.value.currentPassword).toBe('');

    actions.replaceRevokeForm({
      currentPassword: 'super-secret',
      acknowledged: true,
    });
    await actions.revoke();

    expect(api.revokeOperator).toHaveBeenCalledWith(user.id, {
      currentPassword: 'super-secret',
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(actions.revokeForm.value).toEqual({
      currentPassword: '',
      acknowledged: false,
    });
    expect(actions.revokeDialogVisible.value).toBe(false);
  });

  it('reports a refresh warning without turning a successful revoke into a failure', async () => {
    activate(superSession);
    const refresh = vi.fn().mockRejectedValue(new Error('network details'));
    const revoked = { userId: user.id, operator: null };
    api.revokeOperator.mockResolvedValue(revoked);
    const actions = useOperatorActions(refresh);
    actions.openRevoke({ ...user, isOperator: true, operatorActive: true });
    actions.replaceRevokeForm({
      currentPassword: 'super-secret',
      acknowledged: true,
    });

    await expect(actions.revoke()).resolves.toEqual(revoked);

    expect(actions.revokeDialogVisible.value).toBe(false);
    expect(actions.lastError.value).toBeNull();
    expect(actions.lastWarning.value).toBe(
      '操作员角色已撤销，但用户列表刷新失败，请手动刷新',
    );
  });

  it('prevents duplicate and stale submissions from closing a newer dialog', async () => {
    activate(superSession);
    let resolveGrant!: (value: AdminUserStatusView) => void;
    api.grantOperator.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGrant = resolve;
      }),
    );
    const actions = useOperatorActions(vi.fn().mockResolvedValue(undefined));
    actions.openGrant(user);
    actions.replaceGrantForm({
      loginPhone: '13700000000',
      currentPassword: 'super-secret',
      temporaryPassword: 'operator-secret',
      confirmTemporaryPassword: 'operator-secret',
    });

    const pending = actions.grant();
    await expect(actions.grant()).rejects.toThrow(
      '角色操作正在提交，请勿重复操作',
    );
    actions.closeGrant();
    actions.openGrant({ ...user, id: 'user-2', nickname: '新用户' });
    resolveGrant(granted);
    await pending;

    expect(api.grantOperator).toHaveBeenCalledOnce();
    expect(actions.grantDialogVisible.value).toBe(true);
    expect(actions.selectedUser.value?.id).toBe('user-2');
  });
});
