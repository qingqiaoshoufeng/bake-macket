import { defineStore } from 'pinia';

import type { AuthSessionView, UserProfileView } from '@bake-mall/contracts';

import { apiClient } from '../api/http.js';

const TOKEN_STORAGE_KEY = 'bake_user_token';
const PROFILE_STORAGE_KEY = 'bake_user_profile';

type AuthState = {
  accessToken: string | null;
  profile: UserProfileView | null;
};

/**
 * Customer-facing authentication state.
 *
 * - `accessToken` and `profile` are mirrored into `localStorage` so a page
 *   reload preserves the session; nothing sensitive (phone number is masked
 *   by the API) lives in the payload.
 * - The store is the single owner of the bearer token. `apiClient` calls
 *   `setAccessToken` at boot and on login/logout so every request picks up
 *   the latest value without prop-drilling.
 * - `requireVerifiedPhone(redirectPath)` is the contract used by the
 *   checkout / order routes: it returns the login-redirect path whenever the
 *   user lacks a verified phone, or `null` when checkout may proceed.
 */
export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    accessToken: null,
    profile: null,
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.accessToken),
    hasVerifiedPhone: (state) =>
      Boolean(state.profile?.phone && state.profile.phoneVerified),
  },
  actions: {
    /**
     * Restore the persisted session from `localStorage` and re-bind the
     * bearer token on the shared `apiClient`. Called once from `main.ts`
     * before the router mounts.
     */
    hydrate(): void {
      if (typeof window === 'undefined') return;
      try {
        const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
        const profileRaw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
        if (token) {
          this.accessToken = token;
          apiClient.setAccessToken(token);
        }
        if (profileRaw) {
          this.profile = JSON.parse(profileRaw) as UserProfileView;
        }
      } catch {
        // Corrupted storage shouldn't block app boot — drop and continue.
        this.accessToken = null;
        this.profile = null;
      }
    },

    /**
     * Exchange a phone/code pair with `POST /auth/dev/login`. The API treats
     * the dev code as already verifying the phone, so we mirror that into
     * `profile.phoneVerified` immediately.
     */
    async loginWithDevelopmentCode(
      phone: string,
      code: string,
    ): Promise<AuthSessionView> {
      const session = await apiClient.post<AuthSessionView>('/auth/dev/login', {
        phone,
        code,
      });
      this.applySession(session, {
        id: '',
        phone,
        phoneVerified: true,
        nickname: undefined,
        avatarUrl: undefined,
      });
      return session;
    },

    /**
     * Persist the issued token and the user profile snapshot, and forward
     * the bearer token to the shared HTTP client.
     */
    applySession(session: AuthSessionView, profile: UserProfileView): void {
      this.accessToken = session.accessToken;
      this.profile = profile;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, session.accessToken);
        window.localStorage.setItem(
          PROFILE_STORAGE_KEY,
          JSON.stringify(profile),
        );
      }
      apiClient.setAccessToken(session.accessToken);
    },

    /**
     * Replace the cached profile (e.g. after `GET /me` or a phone bind) and
     * re-serialise it. Does not touch the bearer token.
     */
    setProfile(profile: UserProfileView | null): void {
      this.profile = profile;
      if (typeof window !== 'undefined') {
        if (profile) {
          window.localStorage.setItem(
            PROFILE_STORAGE_KEY,
            JSON.stringify(profile),
          );
        } else {
          window.localStorage.removeItem(PROFILE_STORAGE_KEY);
        }
      }
    },

    /**
     * Drop the user session on logout, on a `401` (the HTTP client invokes
     * the registered unauthorized handler) or when a phone re-bind fails.
     */
    clearSession(): void {
      this.accessToken = null;
      this.profile = null;
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      }
      apiClient.setAccessToken(null);
    },

    /**
     * Guard helper used by the router: when the user is anonymous or lacks a
     * verified phone, returns the `/login?redirect=<encoded path>` URL the
     * caller should navigate to; returns `null` when checkout may proceed.
     */
    requireVerifiedPhone(redirectPath: string): string | null {
      if (this.hasVerifiedPhone) return null;
      const normalised = redirectPath.startsWith('/')
        ? redirectPath
        : `/${redirectPath}`;
      return `/login?redirect=${encodeURIComponent(normalised)}`;
    },
  },
});

export type AuthStore = ReturnType<typeof useAuthStore>;
