import {
  AdminPermission,
  AdminRole,
  OPERATOR_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  type AdminLoginRequest,
  type AdminSessionView,
} from '@bake-mall/contracts';
import { defineStore } from 'pinia';

import { apiClient } from '../api/http.js';
import {
  ADMIN_SESSION_STORAGE_KEY,
  clearAdminSessionStorage,
  LEGACY_ADMIN_TOKEN_STORAGE_KEY,
} from '../config/session-storage.js';
import { loginAsAdmin } from '../views/login/api/index.js';

export type AdminProfileView = {
  readonly identifier: string;
};

type PersistedAdminAuth = {
  readonly session: AdminSessionView;
  readonly profile: AdminProfileView;
};

type AdminAuthState = {
  session: AdminSessionView | null;
  profile: AdminProfileView | null;
};

const adminPermissions = new Set(Object.values(AdminPermission));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactPermissions(
  value: readonly AdminPermission[],
  expected: readonly AdminPermission[],
): boolean {
  return (
    value.length === expected.length &&
    expected.every((permission) => value.includes(permission))
  );
}

function isAdminSession(
  value: unknown,
  nowMs: number,
): value is AdminSessionView {
  if (!isRecord(value)) return false;
  const expiresAtMs =
    typeof value.expiresAt === 'string'
      ? Date.parse(value.expiresAt)
      : Number.NaN;
  if (
    typeof value.accessToken !== 'string' ||
    value.accessToken.length === 0 ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= nowMs ||
    !Object.values(AdminRole).includes(value.role as AdminRole) ||
    !Array.isArray(value.permissions) ||
    !value.permissions.every((permission) =>
      adminPermissions.has(permission as AdminPermission),
    ) ||
    typeof value.mustChangePassword !== 'boolean'
  ) {
    return false;
  }

  const permissions = value.permissions as readonly AdminPermission[];
  if (value.mustChangePassword) {
    return value.role === AdminRole.OPERATOR && permissions.length === 0;
  }

  if (value.role === AdminRole.OPERATOR) {
    return hasExactPermissions(permissions, OPERATOR_PERMISSIONS);
  }

  return hasExactPermissions(permissions, SUPER_ADMIN_PERMISSIONS);
}

function isAdminProfile(value: unknown): value is AdminProfileView {
  return (
    isRecord(value) &&
    typeof value.identifier === 'string' &&
    value.identifier.trim().length > 0
  );
}

function parsePersistedAdminAuth(
  value: string,
  nowMs: number,
): PersistedAdminAuth | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      !isAdminSession(parsed.session, nowMs) ||
      !isAdminProfile(parsed.profile)
    ) {
      return null;
    }
    return {
      session: parsed.session,
      profile: { identifier: parsed.profile.identifier },
    };
  } catch {
    return null;
  }
}

export const useAdminAuthStore = defineStore('admin-auth', {
  state: (): AdminAuthState => ({
    session: null,
    profile: null,
  }),
  getters: {
    accessToken: (state): string | null => state.session?.accessToken ?? null,
    role: (state): AdminRole | null => state.session?.role ?? null,
    permissions: (state): readonly AdminPermission[] =>
      state.session?.permissions ?? [],
    mustChangePassword: (state): boolean =>
      state.session?.mustChangePassword ?? false,
    isAuthenticated: (state): boolean => state.session !== null,
  },
  actions: {
    hydrate(nowMs: number = Date.now()): void {
      if (typeof window === 'undefined') return;
      const persistedValue = window.sessionStorage.getItem(
        ADMIN_SESSION_STORAGE_KEY,
      );
      const persisted = persistedValue
        ? parsePersistedAdminAuth(persistedValue, nowMs)
        : null;
      if (!persisted) {
        this.clearSession();
        return;
      }
      this.session = persisted.session;
      this.profile = persisted.profile;
      apiClient.setAccessToken(persisted.session.accessToken);
      window.sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_STORAGE_KEY);
    },

    async loginAsAdmin(request: AdminLoginRequest): Promise<AdminSessionView> {
      const response = await loginAsAdmin(request);
      const identifier =
        request.kind === 'SUPER_ADMIN' ? request.email : request.phone;
      this.applySession(response, { identifier });
      return response;
    },

    applySession(session: AdminSessionView, profile: AdminProfileView): void {
      const nextProfile = { identifier: profile.identifier };
      const persisted: PersistedAdminAuth = {
        session,
        profile: nextProfile,
      };
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          ADMIN_SESSION_STORAGE_KEY,
          JSON.stringify(persisted),
        );
        window.sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_STORAGE_KEY);
      }
      this.session = session;
      this.profile = nextProfile;
      apiClient.setAccessToken(session.accessToken);
    },

    clearSession(): void {
      this.session = null;
      this.profile = null;
      clearAdminSessionStorage();
      apiClient.setAccessToken(null);
    },

    hasPermission(permission: AdminPermission): boolean {
      return this.permissions.includes(permission);
    },

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
