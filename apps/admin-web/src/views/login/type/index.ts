import type { AdminLoginRequest as SharedAdminLoginRequest } from '@bake-mall/contracts';

export type AdminLoginKind = SharedAdminLoginRequest['kind'];

export interface AdminLoginFormValue {
  readonly kind: AdminLoginKind;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
}

export type AdminLoginRequest = SharedAdminLoginRequest;
