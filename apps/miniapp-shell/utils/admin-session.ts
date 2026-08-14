import type {
  AdminSessionView,
  CustomerAuthSessionView,
} from '@bake-mall/contracts';

export type MemorySessionStore<T> = Readonly<{
  clear: () => void;
  get: () => T | null;
  set: (session: T) => void;
}>;

function cloneAdminSession(session: AdminSessionView): AdminSessionView {
  return {
    ...session,
    permissions: [...session.permissions],
  } as AdminSessionView;
}

function cloneCustomerSession(
  session: CustomerAuthSessionView,
): CustomerAuthSessionView {
  return {
    ...session,
    profile: { ...session.profile },
  };
}

function createMemorySessionStore<T>(
  clone: (session: T) => T,
): MemorySessionStore<T> {
  let current: T | null = null;

  function clear(): void {
    current = null;
  }

  function get(): T | null {
    return current ? clone(current) : null;
  }

  function set(session: T): void {
    current = clone(session);
  }

  return { clear, get, set };
}

export function createAdminSessionStore(): MemorySessionStore<AdminSessionView> {
  return createMemorySessionStore(cloneAdminSession);
}

export function createCustomerSessionStore(): MemorySessionStore<CustomerAuthSessionView> {
  return createMemorySessionStore(cloneCustomerSession);
}
