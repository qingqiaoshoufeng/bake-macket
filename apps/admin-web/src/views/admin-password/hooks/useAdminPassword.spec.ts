import {
  AdminRole,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAdminAuthStore } from '../../../stores/admin-auth.js';
import { useAdminPassword } from './useAdminPassword.js';

const passwordApi = vi.hoisted(() => ({
  changeInitial: vi.fn(),
  changeCurrent: vi.fn(),
}));

vi.mock('../api/index.js', () => ({
  changeInitialAdminPassword: passwordApi.changeInitial,
  changeAdminPassword: passwordApi.changeCurrent,
}));

const restrictedSession: AdminSessionView = {
  accessToken: 'restricted-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: [],
  mustChangePassword: true,
};

const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

const superAdminSession: AdminSessionView = {
  accessToken: 'super-token',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.SUPER_ADMIN,
  permissions: SUPER_ADMIN_PERMISSIONS,
  mustChangePassword: false,
};

function fillPasswords(
  password: ReturnType<typeof useAdminPassword>,
  currentPassword: string,
  newPassword = '654321',
): void {
  password.replaceForm({
    currentPassword,
    newPassword,
    confirmPassword: newPassword,
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe('useAdminPassword', () => {
  it('uses the initial endpoint and atomically applies its full operator session', async () => {
    const auth = useAdminAuthStore();
    auth.applySession(restrictedSession, { identifier: '13800000000' });
    passwordApi.changeInitial.mockResolvedValue(operatorSession);
    const password = useAdminPassword();
    expect(password.mode.value).toBe('initial');
    fillPasswords(password, '123456');

    await expect(password.submit()).resolves.toEqual(operatorSession);

    expect(passwordApi.changeInitial).toHaveBeenCalledWith({
      temporaryPassword: '123456',
      newPassword: '654321',
      confirmPassword: '654321',
    });
    expect(passwordApi.changeCurrent).not.toHaveBeenCalled();
    expect(auth.session).toEqual(operatorSession);
    expect(auth.profile).toEqual({ identifier: '13800000000' });
    expect(password.form.value).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  });

  it('uses the ordinary endpoint for a complete session', async () => {
    const auth = useAdminAuthStore();
    auth.applySession(superAdminSession, { identifier: 'admin@example.com' });
    passwordApi.changeCurrent.mockResolvedValue(superAdminSession);
    const password = useAdminPassword();
    fillPasswords(password, 'admin-password');

    await password.submit();

    expect(password.mode.value).toBe('current');
    expect(passwordApi.changeCurrent).toHaveBeenCalledWith({
      currentPassword: 'admin-password',
      newPassword: '654321',
      confirmPassword: '654321',
    });
    expect(passwordApi.changeInitial).not.toHaveBeenCalled();
    expect(auth.session).toEqual(superAdminSession);
  });

  it('clears every password in finally when the request fails', async () => {
    const auth = useAdminAuthStore();
    auth.applySession(operatorSession, { identifier: '13800000000' });
    passwordApi.changeCurrent.mockRejectedValue(new Error('旧密码中含敏感值'));
    const password = useAdminPassword();
    fillPasswords(password, '123456');

    await expect(password.submit()).rejects.toThrow('旧密码中含敏感值');

    expect(password.submitting.value).toBe(false);
    expect(password.form.value).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  });

  it('rejects mismatched confirmation before sending a request', async () => {
    const auth = useAdminAuthStore();
    auth.applySession(operatorSession, { identifier: '13800000000' });
    const password = useAdminPassword();
    password.replaceForm({
      currentPassword: '123456',
      newPassword: '654321',
      confirmPassword: '000000',
    });

    await expect(password.submit()).rejects.toThrow('两次输入的新密码不一致');

    expect(passwordApi.changeCurrent).not.toHaveBeenCalled();
    expect(password.form.value).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  });

  it.each([
    {
      field: 'currentPassword',
      form: {
        currentPassword: '',
        newPassword: '654321',
        confirmPassword: '654321',
      },
    },
    {
      field: 'newPassword',
      form: {
        currentPassword: '123456',
        newPassword: '',
        confirmPassword: '654321',
      },
    },
    {
      field: 'confirmPassword',
      form: {
        currentPassword: '123456',
        newPassword: '654321',
        confirmPassword: '',
      },
    },
  ])(
    'clears all three fields without calling the API when $field is missing',
    async ({ form }) => {
      const auth = useAdminAuthStore();
      auth.applySession(operatorSession, { identifier: '13800000000' });
      const password = useAdminPassword();
      password.replaceForm(form);

      await expect(password.submit()).rejects.toThrow('请完整填写三个密码字段');

      expect(passwordApi.changeInitial).not.toHaveBeenCalled();
      expect(passwordApi.changeCurrent).not.toHaveBeenCalled();
      expect(password.submitting.value).toBe(false);
      expect(password.form.value).toEqual({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    },
  );
});
