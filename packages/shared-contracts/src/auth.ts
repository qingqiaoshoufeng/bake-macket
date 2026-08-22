import type { CustomerProfileView } from './customer.js';
import { AdminPermission, AdminRole } from './enums.js';

export const OPERATOR_PERMISSIONS = Object.freeze([
  AdminPermission.ORDER_READ,
  AdminPermission.ORDER_STATUS_UPDATE,
  AdminPermission.USER_READ,
  AdminPermission.USER_WECHAT_IDENTITY_READ,
  AdminPermission.USER_CREATE,
  AdminPermission.PRINT_DEVICE_MANAGE,
  AdminPermission.PRINT_EXECUTE,
  AdminPermission.PRINT_HISTORY_READ,
  AdminPermission.SELF_PASSWORD_CHANGE,
] as const);

export const SUPER_ADMIN_PERMISSIONS = OPERATOR_PERMISSIONS;

export type RestrictedAdminSessionView = {
  accessToken: string;
  expiresAt: string;
  role: AdminRole.OPERATOR;
  permissions: readonly [];
  mustChangePassword: true;
};

export type FullOperatorAdminSessionView = {
  accessToken: string;
  expiresAt: string;
  role: AdminRole.OPERATOR;
  permissions: typeof OPERATOR_PERMISSIONS;
  mustChangePassword: false;
};

export type FullSuperAdminSessionView = {
  accessToken: string;
  expiresAt: string;
  role: AdminRole.SUPER_ADMIN;
  permissions: typeof SUPER_ADMIN_PERMISSIONS;
  mustChangePassword: false;
};

export type FullAdminSessionView =
  FullOperatorAdminSessionView | FullSuperAdminSessionView;

export type AdminSessionView =
  RestrictedAdminSessionView | FullAdminSessionView;

export interface SuperAdminLoginRequest {
  kind: 'SUPER_ADMIN';
  email: string;
  phone?: never;
  password: string;
}

export interface OperatorLoginRequest {
  kind: 'OPERATOR';
  email?: never;
  phone: string;
  password: string;
}

export type AdminLoginRequest = SuperAdminLoginRequest | OperatorLoginRequest;

export type ChangeAdminPasswordRequest = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export interface ExchangeOperatorSessionRequest {
  readonly __exchangeOperatorSessionRequest?: never;
}

export type ChangeInitialOperatorPasswordRequest = {
  temporaryPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type AuthSessionView = {
  accessToken: string;
  expiresAt: string;
};

export type CustomerAuthSessionView = AuthSessionView & {
  profile: UserProfileView;
};

export type WechatLoginRequest = {
  code: string;
};

export type WechatPhoneRequest = {
  code: string;
};

export type WechatLoginResponse = CustomerAuthSessionView;
export type WechatPhoneResponse = CustomerAuthSessionView;

export type BindPhoneRequest = {
  phone: string;
  code: string;
};

export type UserProfileView = {
  id: string;
  nickname?: string;
  avatarUrl?: string;
  phone?: string;
  phoneVerified: boolean;
  profileCompleted?: boolean;
  orderContactPhone: import('./customer.js').OrderContactPhoneView;
};
