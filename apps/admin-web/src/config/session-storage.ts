export const ADMIN_SESSION_STORAGE_KEY = 'bake_admin_session';
export const LEGACY_ADMIN_TOKEN_STORAGE_KEY = 'bake_admin_token';
export const PENDING_DEVICE_OPERATIONS_STORAGE_KEY =
  'bake_admin_pending_device_operations';

export function clearAdminSessionStorage(): void {
  if (typeof window === 'undefined') return;
  [
    ADMIN_SESSION_STORAGE_KEY,
    LEGACY_ADMIN_TOKEN_STORAGE_KEY,
    PENDING_DEVICE_OPERATIONS_STORAGE_KEY,
  ].forEach((key) => window.sessionStorage.removeItem(key));
}
