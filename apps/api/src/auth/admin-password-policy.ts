import { ApiErrorCode } from '@bake-mall/contracts';

export type AdminPasswordPolicyResult =
  | { ok: true }
  | { ok: false; code: ApiErrorCode.ADMIN_PASSWORD_POLICY_VIOLATION };

const ADMIN_PASSWORD_PATTERN = /^[0-9]{6,}$/u;

export const validateAdminPassword = (
  password: string,
): AdminPasswordPolicyResult =>
  password === password.trim() && ADMIN_PASSWORD_PATTERN.test(password)
    ? { ok: true }
    : { ok: false, code: ApiErrorCode.ADMIN_PASSWORD_POLICY_VIOLATION };
