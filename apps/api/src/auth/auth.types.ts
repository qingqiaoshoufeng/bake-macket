import { JWT_ADMIN_AUDIENCE, JWT_USER_AUDIENCE } from './auth.constants.js';

/**
 * Shape attached to `request.user` by {@link JwtUserGuard}. Only the minimum
 * identity needed by downstream handlers (creating orders, binding phone, …)
 * is carried in the token and forwarded to the controller via
 * {@link CurrentUser}.
 */
export type AuthenticatedUser = {
  id: string;
  phone: string | null;
};

/**
 * Shape attached to `request.admin` by {@link JwtAdminGuard}. Mirrors
 * {@link AuthenticatedUser} but is keyed under a different property to keep
 * the two principals disjoint at the request level.
 */
export type AuthenticatedAdmin = {
  id: string;
  email: string;
};

/**
 * JWT payload signed by {@link UserAuthService}. The `aud` claim is fixed to
 * `'mall-user'` so {@link JwtUserGuard} can reject cross-audience tokens.
 */
export type UserJwtPayload = {
  sub: string;
  aud: typeof JWT_USER_AUDIENCE;
  phone: string | null;
};

/**
 * JWT payload signed by {@link AdminAuthService}. The `aud` claim is fixed to
 * `'mall-admin'` so {@link JwtAdminGuard} can reject cross-audience tokens.
 */
export type AdminJwtPayload = {
  sub: string;
  aud: typeof JWT_ADMIN_AUDIENCE;
  email: string;
};

/**
 * Successful login/registration response shape returned by the user auth
 * endpoints. Mirrors `AuthSessionView` from `@bake-mall/contracts`.
 */
export type AuthSession = {
  accessToken: string;
  expiresAt: string;
};
