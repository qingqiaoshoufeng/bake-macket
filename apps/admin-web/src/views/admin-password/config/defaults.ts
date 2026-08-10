import type { AdminPasswordForm } from '../type/index.js';

export function createAdminPasswordDefaults(): AdminPasswordForm {
  return {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  };
}
