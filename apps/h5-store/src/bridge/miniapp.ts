/**
 * Bridge contract shared with the native miniapp shell (`apps/miniapp-shell`).
 *
 * The shell posts `MessageEvent`s into the `web-view` carrying either:
 *
 * - a WeChat login code (to be exchanged server-side for a union id), or
 * - a phone credential produced by `getPhoneNumber`.
 *
 * Both messages are tagged with `source: 'bake-miniapp'` so the H5 page can
 * distinguish the native host from any other `window.postMessage` traffic.
 */
export type MiniappMessage =
  | {
      source: 'bake-miniapp';
      type: 'WECHAT_CODE';
      code: string;
    }
  | {
      source: 'bake-miniapp';
      type: 'PHONE_CREDENTIAL';
      credential: string;
    };

/**
 * Install a `message` listener that filters for the miniapp-issued envelope.
 * Returns a teardown function the caller can invoke on app teardown.
 *
 * The handler is a no-op outside a browser environment so SSR-style test
 * harnesses can import the module without throwing on `window`.
 */
export function installMiniappBridge(
  onMessage: (message: MiniappMessage) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  const listener = (event: MessageEvent<MiniappMessage>): void => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'bake-miniapp') return;
    onMessage(data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/**
 * Convenience helper used by tests and by the login view to build payloads
 * that mimic the native host. Not used in production H5 code; exposed so the
 * dev panel can simulate a WeChat login without the actual miniapp shell.
 */
export function makeWechatCodeMessage(code: string): MiniappMessage {
  return { source: 'bake-miniapp', type: 'WECHAT_CODE', code };
}

export function makePhoneCredentialMessage(credential: string): MiniappMessage {
  return {
    source: 'bake-miniapp',
    type: 'PHONE_CREDENTIAL',
    credential,
  };
}

/**
 * Fixed development phone + code hint shown on the login view when the app
 * is built outside production. Mirrors the API's
 * `DEVELOPMENT_VERIFICATION_CODE` constant in `apps/api/src/auth`.
 */
export const DEVELOPMENT_LOGIN_HINT = {
  phone: '13800000000',
  code: '123456',
} as const;
