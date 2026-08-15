import type {
  AdminSessionView,
  ChangeAdminPasswordRequest,
  ChangeInitialOperatorPasswordRequest,
  CustomerAuthSessionView,
} from '@bake-mall/contracts';

import { ADMIN_ROUTES } from '../config/navigation.js';
import type {
  AdminAuthState,
  AdminPasswordForm,
  AdminPasswordMode,
} from '../type/index.js';
import type { MemorySessionStore } from '../../utils/admin-session.js';

const EMPTY_PASSWORD_FORM: AdminPasswordForm = Object.freeze({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

type AdminAuthApi = Readonly<{
  exchange: () => Promise<AdminSessionView>;
  loginWithWechat: (code: string) => Promise<CustomerAuthSessionView>;
}>;

type AdminAuthDependencies = Readonly<{
  adminSession: MemorySessionStore<AdminSessionView>;
  api: AdminAuthApi;
  customerSession: MemorySessionStore<CustomerAuthSessionView>;
  login: () => Promise<string>;
  navigate: (route: string) => void;
  toast: (message: string) => void;
}>;

type AdminPasswordDependencies = Readonly<{
  adminSession: MemorySessionStore<AdminSessionView>;
  api: Readonly<{
    changeCurrent: (
      request: ChangeAdminPasswordRequest,
    ) => Promise<AdminSessionView>;
    changeInitial: (
      request: ChangeInitialOperatorPasswordRequest,
    ) => Promise<AdminSessionView>;
  }>;
}>;

function clonePasswordForm(form: AdminPasswordForm): AdminPasswordForm {
  return { ...form };
}

function normalizedCredential(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 401
  );
}

function isIneligible(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error.status === 401 || error.status === 403)
  );
}

function safeAuthMessage(error: unknown): string {
  if (isUnauthorized(error)) return '管理员会话已失效，请重新进入';
  return '管理入口暂不可用，请稍后重试';
}

function targetRoute(session: AdminSessionView): string {
  return session.mustChangePassword ? ADMIN_ROUTES.password : ADMIN_ROUTES.home;
}

export function createAdminAuthController(dependencies: AdminAuthDependencies) {
  let generation = 0;
  let state: AdminAuthState = { eligible: false, loading: false };

  function snapshot(): AdminAuthState {
    return { ...state };
  }

  function begin(): number {
    generation += 1;
    state = { eligible: false, loading: true };
    return generation;
  }

  function current(requestGeneration: number): boolean {
    return requestGeneration === generation;
  }

  async function freshCustomer(
    requestGeneration: number,
  ): Promise<CustomerAuthSessionView | null> {
    const code = normalizedCredential(await dependencies.login());
    if (!code) return null;
    const session = await dependencies.api.loginWithWechat(code);
    if (!current(requestGeneration)) return null;
    dependencies.customerSession.set(session);
    return session;
  }

  async function exchange(
    requestGeneration: number,
  ): Promise<AdminSessionView | null> {
    const session = await dependencies.api.exchange();
    return current(requestGeneration) ? session : null;
  }

  async function refreshEligibility(): Promise<boolean> {
    const requestGeneration = begin();
    try {
      const customer = await freshCustomer(requestGeneration);
      if (!customer) return false;
      const admin = await exchange(requestGeneration);
      if (!admin) return false;
      if (current(requestGeneration))
        state = { eligible: true, loading: false };
      return true;
    } catch (error) {
      if (current(requestGeneration)) {
        dependencies.adminSession.clear();
        state = { eligible: false, loading: false };
        if (!isIneligible(error)) dependencies.toast(safeAuthMessage(error));
      }
      return false;
    } finally {
      if (current(requestGeneration)) state = { ...state, loading: false };
    }
  }

  async function enterAdmin(): Promise<boolean> {
    const requestGeneration = begin();
    try {
      const customer = await freshCustomer(requestGeneration);
      if (!customer) return false;
      const admin = await exchange(requestGeneration);
      if (!admin) return false;
      dependencies.adminSession.set(admin);
      state = { eligible: true, loading: false };
      dependencies.navigate(targetRoute(admin));
      return true;
    } catch (error) {
      if (current(requestGeneration)) {
        dependencies.adminSession.clear();
        state = { eligible: false, loading: false };
        if (!isIneligible(error)) dependencies.toast(safeAuthMessage(error));
      }
      return false;
    } finally {
      if (current(requestGeneration)) state = { ...state, loading: false };
    }
  }

  return { enterAdmin, refreshEligibility, snapshot } as const;
}

function validatePasswordForm(form: AdminPasswordForm): void {
  if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
    throw new Error('请完整填写三个密码字段');
  }
  if (form.newPassword !== form.confirmPassword) {
    throw new Error('两次输入的新密码不一致');
  }
}

export function createAdminPasswordController(
  dependencies: AdminPasswordDependencies,
) {
  let form = clonePasswordForm(EMPTY_PASSWORD_FORM);
  let submitting = false;

  function mode(): AdminPasswordMode {
    return dependencies.adminSession.get()?.mustChangePassword
      ? 'initial'
      : 'current';
  }

  function snapshot() {
    return { form: clonePasswordForm(form), mode: mode(), submitting } as const;
  }

  function replaceForm(nextForm: AdminPasswordForm): void {
    form = clonePasswordForm(nextForm);
  }

  async function submit(): Promise<AdminSessionView> {
    const request = clonePasswordForm(form);
    submitting = true;
    try {
      validatePasswordForm(request);
      const session =
        mode() === 'initial'
          ? await dependencies.api.changeInitial({
              temporaryPassword: request.currentPassword,
              newPassword: request.newPassword,
              confirmPassword: request.confirmPassword,
            })
          : await dependencies.api.changeCurrent(request);
      dependencies.adminSession.set(session);
      return session;
    } finally {
      form = clonePasswordForm(EMPTY_PASSWORD_FORM);
      submitting = false;
    }
  }

  return { replaceForm, snapshot, submit } as const;
}
