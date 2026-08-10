import type { AdminSessionView } from '@bake-mall/contracts';
import { computed, ref, type ComputedRef, type Ref } from 'vue';

import { useAdminAuthStore } from '../../../stores/admin-auth.js';
import {
  changeAdminPassword,
  changeInitialAdminPassword,
} from '../api/index.js';
import { createAdminPasswordDefaults } from '../config/defaults.js';
import type { AdminPasswordForm, AdminPasswordMode } from '../type/index.js';

export type UseAdminPasswordResult = {
  readonly form: Ref<AdminPasswordForm>;
  readonly mode: ComputedRef<AdminPasswordMode>;
  readonly submitting: Ref<boolean>;
  readonly replaceForm: (form: AdminPasswordForm) => void;
  readonly submit: () => Promise<AdminSessionView>;
};

function validateAdminPasswordForm(form: AdminPasswordForm): void {
  if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
    throw new Error('请完整填写三个密码字段');
  }
  if (form.newPassword !== form.confirmPassword) {
    throw new Error('两次输入的新密码不一致');
  }
}

export function useAdminPassword(): UseAdminPasswordResult {
  const adminAuth = useAdminAuthStore();
  const form = ref<AdminPasswordForm>(createAdminPasswordDefaults());
  const submitting = ref(false);
  const mode = computed<AdminPasswordMode>(() =>
    adminAuth.mustChangePassword ? 'initial' : 'current',
  );

  function replaceForm(nextForm: AdminPasswordForm): void {
    form.value = { ...nextForm };
  }

  async function submit(): Promise<AdminSessionView> {
    const request = { ...form.value };
    submitting.value = true;
    try {
      validateAdminPasswordForm(request);
      const session =
        mode.value === 'initial'
          ? await changeInitialAdminPassword({
              temporaryPassword: request.currentPassword,
              newPassword: request.newPassword,
              confirmPassword: request.confirmPassword,
            })
          : await changeAdminPassword(request);
      const profile = adminAuth.profile;
      if (!profile) throw new Error('管理员会话已失效，请重新登录');
      adminAuth.applySession(session, profile);
      return session;
    } finally {
      form.value = createAdminPasswordDefaults();
      submitting.value = false;
    }
  }

  return {
    form,
    mode,
    submitting,
    replaceForm,
    submit,
  };
}
