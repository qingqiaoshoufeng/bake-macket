/**
 * Fixed audience claims for the two isolated JWT classes used by the API.
 *
 * - User sessions always carry `aud = 'mall-user'`.
 * - Admin sessions always carry `aud = 'mall-admin'`.
 *
 * The `JwtUserGuard` and `JwtAdminGuard` compare the incoming `aud` claim
 * against these constants before attaching the principal to the request, so
 * a token signed for the wrong audience is rejected with `401 Unauthorized`.
 */
export const JWT_USER_AUDIENCE = 'mall-user' as const;
export const JWT_ADMIN_AUDIENCE = 'mall-admin' as const;

export type JwtAudience = typeof JWT_USER_AUDIENCE | typeof JWT_ADMIN_AUDIENCE;

/**
 * The fixed development verification code that {@link UserAuthService}
 * accepts in non-production environments. Production environments must reject
 * this code outright per the design spec (`Section 3` — identity acquisition
 * will later move to WeChat OAuth).
 */
export const DEVELOPMENT_VERIFICATION_CODE = '123456';
