import type {
  ChangeAdminPasswordRequest,
  ChangeInitialOperatorPasswordRequest,
} from '@bake-mall/contracts';

export type AdminPasswordMode = 'initial' | 'current';

export type AdminPasswordForm = {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmPassword: string;
};

export type InitialAdminPasswordRequest = ChangeInitialOperatorPasswordRequest;
export type CurrentAdminPasswordRequest = ChangeAdminPasswordRequest;
