import { JWT_ADMIN_AUDIENCE, JWT_USER_AUDIENCE } from './auth.constants.js';

/**
 * Shape attached to `request.user` by {@link JwtUserGuard}. The guard builds
 * this principal from the persisted user row after validating the token, so
 * downstream handlers never authorize against stale token identity fields.
 */
export type AuthenticatedUser = {
  id: string;
  phone: string | null;
  phoneVerified: boolean;
};

/**
 * Shape attached to `request.admin` by {@link JwtAdminGuard}. Mirrors
 * {@link AuthenticatedUser} but is keyed under a different property to keep
 * the two principals disjoint at the request level.
 */
export type AuthenticatedAdmin = {
  id: string;
  username: string | null;
  role: import('@bake-mall/contracts').AdminRole;
  linkedUserId: string | null;
  mustChangePassword: boolean;
  permissions: readonly import('@bake-mall/contracts').AdminPermission[];
};

/**
 * JWT payload signed by {@link UserAuthService}. The `aud` claim is fixed to
 * `'mall-user'` so {@link JwtUserGuard} can reject cross-audience tokens.
 */
export type UserJwtPayload = {
  sub: string;
  aud: typeof JWT_USER_AUDIENCE;
  phone: string | null;
  tokenVersion: number;
};

/**
 * JWT payload signed by {@link AdminAuthService}. The `aud` claim is fixed to
 * `'mall-admin'` so {@link JwtAdminGuard} can reject cross-audience tokens.
 */
export type AdminJwtPayload = {
  sub: string;
  aud: typeof JWT_ADMIN_AUDIENCE;
  role: import('@bake-mall/contracts').AdminRole;
  tokenVersion: number;
  linkedUserId: string | null;
  mustChangePassword: boolean;
};

/**
 * Successful login/registration response shape returned by the user auth
 * endpoints. Mirrors `AuthSessionView` from `@bake-mall/contracts`.
 */
export type AuthSession = {
  accessToken: string;
  expiresAt: string;
};
