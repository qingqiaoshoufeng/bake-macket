import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

import { useAdminAuthStore } from '../../../stores/admin-auth.js';
import { loginAsAdmin } from '../api/index.js';
import { getDefaultAdminLogin } from '../config/default-admin-login.js';
import type { AdminLoginFormValue } from '../type/index.js';

const getLoginDefaults = (): AdminLoginFormValue =>
  import.meta.env.DEV && import.meta.env.MODE !== 'production'
    ? getDefaultAdminLogin({
        isDevelopment: true,
        email: import.meta.env.VITE_ADMIN_EMAIL,
        password: import.meta.env.VITE_ADMIN_PASSWORD,
      })
    : getDefaultAdminLogin({ isDevelopment: false });

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '登录失败,请稍后重试';

export function useAdminLogin() {
  const adminAuth = useAdminAuthStore();
  const router = useRouter();
  const route = useRoute();
  const defaults = getLoginDefaults();
  const email = ref(defaults.email);
  const password = ref(defaults.password);
  const submitting = ref(false);
  const showDevHint = computed(() => !import.meta.env.PROD);
  const redirectTarget = computed(() => {
    const value = route.query.redirect;
    return typeof value === 'string' && value.startsWith('/')
      ? value
      : '/dashboard';
  });

  async function submit(): Promise<void> {
    if (!email.value || !password.value) {
      ElMessage.warning('请输入管理员邮箱与密码');
      return;
    }

    submitting.value = true;
    try {
      const normalisedEmail = email.value.trim();
      const session = await loginAsAdmin({
        email: normalisedEmail,
        password: password.value,
      });
      adminAuth.applySession(session, normalisedEmail);
      ElMessage.success('登录成功');
      await router.replace(redirectTarget.value);
    } catch (error) {
      ElMessage.error(getErrorMessage(error));
    } finally {
      submitting.value = false;
    }
  }

  return {
    email,
    password,
    submitting,
    showDevHint,
    submit,
  };
}
