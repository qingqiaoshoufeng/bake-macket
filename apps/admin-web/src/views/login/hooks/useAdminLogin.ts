import { ApiErrorCode } from '@bake-mall/contracts';
import { ElMessage } from 'element-plus';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiClientError } from '../../../api/http.js';
import { useAdminAuthStore } from '../../../stores/admin-auth.js';
import { loginAsAdmin } from '../api/index.js';
import { getDefaultAdminLogin } from '../config/default-admin-login.js';
import type {
  AdminLoginFormValue,
  AdminLoginKind,
  AdminLoginRequest,
} from '../type/index.js';

const getLoginDefaults = (): AdminLoginFormValue => {
  const defaults =
    import.meta.env.DEV && import.meta.env.MODE !== 'production'
      ? getDefaultAdminLogin({
          isDevelopment: true,
          email: import.meta.env.VITE_ADMIN_EMAIL,
          password: import.meta.env.VITE_ADMIN_PASSWORD,
        })
      : getDefaultAdminLogin({ isDevelopment: false });
  return {
    kind: 'SUPER_ADMIN',
    email: defaults.email,
    phone: '',
    password: defaults.password,
  };
};

function buildLoginRequest(form: AdminLoginFormValue): AdminLoginRequest {
  return form.kind === 'SUPER_ADMIN'
    ? {
        kind: 'SUPER_ADMIN',
        email: form.email.trim(),
        password: form.password,
      }
    : {
        kind: 'OPERATOR',
        phone: form.phone.trim(),
        password: form.password,
      };
}

function isComplete(form: AdminLoginFormValue): boolean {
  const identifier = form.kind === 'SUPER_ADMIN' ? form.email : form.phone;
  return Boolean(identifier.trim() && form.password);
}

const API_ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  [ApiErrorCode.ADMIN_VERIFICATION_FAILED]: '账号或密码错误',
  [ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED]: '尝试次数过多，请稍后重试',
};

function safeLoginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '登录失败，请稍后重试';
  return (
    (error.code && API_ERROR_MESSAGES[error.code]) ?? '登录失败，请稍后重试'
  );
}

export function useAdminLogin() {
  const adminAuth = useAdminAuthStore();
  const router = useRouter();
  const route = useRoute();
  const defaults = getLoginDefaults();
  const kind = ref<AdminLoginKind>(defaults.kind);
  const email = ref(defaults.email);
  const phone = ref(defaults.phone);
  const password = ref(defaults.password);
  const submitting = ref(false);
  const showDevHint = computed(() => !import.meta.env.PROD);
  let latestAttempt = 0;
  const redirectTarget = computed(() => {
    const value = route.query.redirect;
    return typeof value === 'string' && value.startsWith('/')
      ? value
      : '/dashboard';
  });

  function selectKind(nextKind: AdminLoginKind): void {
    kind.value = nextKind;
  }

  async function submit(): Promise<void> {
    const form: AdminLoginFormValue = {
      kind: kind.value,
      email: email.value,
      phone: phone.value,
      password: password.value,
    };
    if (!isComplete(form)) {
      ElMessage.warning(
        kind.value === 'SUPER_ADMIN'
          ? '请输入管理员邮箱与密码'
          : '请输入操作员手机号与密码',
      );
      return;
    }

    const attempt = latestAttempt + 1;
    latestAttempt = attempt;
    submitting.value = true;
    try {
      const request = buildLoginRequest(form);
      const session = await loginAsAdmin(request);
      if (attempt !== latestAttempt) return;
      const identifier =
        request.kind === 'SUPER_ADMIN' ? request.email : request.phone;
      adminAuth.applySession(session, { identifier });
      ElMessage.success('登录成功');
      const target = session.mustChangePassword
        ? '/admin-password'
        : session.role === 'OPERATOR' && redirectTarget.value === '/dashboard'
          ? '/orders'
          : redirectTarget.value;
      await router.replace(target);
    } catch (error) {
      if (attempt === latestAttempt) {
        ElMessage.error(safeLoginErrorMessage(error));
      }
    } finally {
      if (attempt === latestAttempt) {
        submitting.value = false;
      }
    }
  }

  return {
    kind,
    email,
    phone,
    password,
    submitting,
    showDevHint,
    selectKind,
    submit,
  };
}
