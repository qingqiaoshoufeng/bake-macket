import {
  AdminRole,
  OPERATOR_PERMISSIONS,
  type AdminSessionView,
} from '@bake-mall/contracts';

export const ADMIN_PASSWORD_SESSION_MOCK: AdminSessionView = {
  accessToken: 'operator-session-after-password-change',
  expiresAt: '2026-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};
