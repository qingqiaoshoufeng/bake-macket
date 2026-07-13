import { defineStore } from 'pinia';

import type { AuthSessionView } from '@bake-mall/contracts';

import { apiClient } from '../api/http.js';

/**
 * Storage key for the merchant administrator's bearer token. Kept separate
 * from the H5 customer's `bake_user_token` so the two audiences never share
 * credentials. `sessionStorage` is intentional: an unattended merchant kiosk
 * should not silently re-authenticate on the next page load.
 */
const TOKEN_STORAGE_KEY = 'bake_admin_token';

/**
 * Profile displayed by the admin layout's user menu. Built up after login
 * from the `email` claim in the JWT (we currently do not expose a
 * `/admin/auth/me` round-trip in the first iteration).
 */
export type AdminProfileView = {
  email: string;
  displayName?: string;
};

type AdminLoginResponse = AuthSessionView;

type AdminAuthState = {
  accessToken: string | null;
  profile: AdminProfileView | null;
};

/**
 * Merchant administrator authentication state.
 *
 * - The store is the single owner of the bearer token. `apiClient` calls
 *   `setAccessToken` at boot and on login/logout so every admin request
 *   picks up the latest value without prop-drilling.
 * - `requireAdminAuth(redirectPath)` is the contract used by the router:
 *   it returns the `/login?redirect=<encoded path>` URL whenever the
 *   session is missing, or `null` when the protected page may render.
 * - The H5 customer store deliberately lives next to this one — sharing the
 *   bearer state would re-introduce the cross-audience bug the spec calls
 *   out as a security boundary.
 */
export const useAdminAuthStore = defineStore('admin-auth', {
  state: (): AdminAuthState => ({
    accessToken: null,
    profile: null,
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.accessToken),
  },
  actions: {
    /**
     * Restore the persisted session from `sessionStorage` and re-bind the
     * bearer token on the shared `apiClient`. Called once from `main.ts`
     * before the router mounts.
     */
    hydrate(): void {
      if (typeof window === 'undefined') return;
      try {
        const token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
        if (token) {
          this.accessToken = token;
          apiClient.setAccessToken(token);
        }
      } catch {
        // Corrupted storage shouldn't block app boot — drop and continue.
        this.accessToken = null;
      }
    },

    /**
     * Exchange an email/password pair with `POST /admin/auth/login`. On
     * success the issued token is persisted to `sessionStorage` and bound
     * on the shared HTTP client so subsequent admin requests authenticate
     * automatically.
     */
    async loginAsAdmin(
      email: string,
      password: string,
    ): Promise<AdminLoginResponse> {
      const response = await apiClient.post<AdminLoginResponse>(
        '/admin/auth/login',
        { email, password },
      );
      this.applySession(response);
      return response;
    },

    /**
     * Persist the issued token and the admin profile snapshot, and forward
     * the bearer token to the shared HTTP client.
     */
    applySession(session: AdminLoginResponse): void {
      this.accessToken = session.accessToken;
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, session.accessToken);
      }
      apiClient.setAccessToken(session.accessToken);
    },

    /**
     * Drop the admin session on logout or on a `401` (the HTTP client
     * invokes the registered unauthorized handler).
     */
    clearSession(): void {
      this.accessToken = null;
      this.profile = null;
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
      apiClient.setAccessToken(null);
    },

    /**
     * Guard helper used by the router: when the admin is anonymous returns
     * the `/login?redirect=<encoded path>` URL the caller should navigate
     * to; returns `null` when the protected page may render.
     */
    requireAdminAuth(redirectPath: string): string | null {
      if (this.isAuthenticated) return null;
      const normalised = redirectPath.startsWith('/')
        ? redirectPath
        : `/${redirectPath}`;
      return `/login?redirect=${encodeURIComponent(normalised)}`;
    },
  },
});

export type AdminAuthStore = ReturnType<typeof useAdminAuthStore>;
