import { ensureMiniProgramJssdk } from './jssdk.js';

export type MiniappMessage =
  | Readonly<{
      source: 'bake-miniapp';
      type: 'WECHAT_CODE';
      code: string;
    }>
  | Readonly<{
      source: 'bake-miniapp';
      type: 'PHONE_CREDENTIAL';
      credential: string;
    }>;

export const MAX_MINIAPP_PHONE_ROUTE_LENGTH = 1024;

const PHONE_AUTH_ROUTE = '/pages/phone-auth/index?returnUrl=';
const HANDOFF_PARAMETERS = [
  'miniappSource',
  'miniappType',
  'wechatCode',
  'phoneCredential',
] as const;

type MiniProgramNavigator = Readonly<{
  navigateTo: (
    options: Readonly<{
      url: string;
      success: () => void;
      fail: () => void;
    }>,
  ) => void;
}>;

type MiniappMessageSubscriber = (message: MiniappMessage) => void;

export type MiniappMessageHub = Readonly<{
  publish: (message: MiniappMessage) => void;
  subscribe: (subscriber: MiniappMessageSubscriber) => () => void;
}>;

declare global {
  interface Window {
    wx?: Readonly<{ miniProgram?: MiniProgramNavigator }>;
  }
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function parseMiniappMessage(value: unknown): MiniappMessage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.source !== 'bake-miniapp') return null;

  if (record.type === 'WECHAT_CODE') {
    const code = parseNonEmptyString(record.code);
    return code && !Object.hasOwn(record, 'credential')
      ? { source: 'bake-miniapp', type: 'WECHAT_CODE', code }
      : null;
  }
  if (record.type === 'PHONE_CREDENTIAL') {
    const credential = parseNonEmptyString(record.credential);
    return credential && !Object.hasOwn(record, 'code')
      ? { source: 'bake-miniapp', type: 'PHONE_CREDENTIAL', credential }
      : null;
  }
  return null;
}

function containsMalformedPercent(value: string): boolean {
  return /%(?![0-9a-fA-F]{2})/.test(value);
}

function hasExactParameterCount(
  url: URL,
  parameter: (typeof HANDOFF_PARAMETERS)[number],
  count: number,
): boolean {
  return url.searchParams.getAll(parameter).length === count;
}

function parseUrlHandoff(url: URL): MiniappMessage | null {
  if (containsMalformedPercent(url.search)) return null;
  const sources = url.searchParams.getAll('miniappSource');
  const types = url.searchParams.getAll('miniappType');
  if (sources.length !== 1 || types.length !== 1) return null;

  const [source] = sources;
  const [type] = types;
  if (source !== 'bake-miniapp') return null;
  if (
    type === 'WECHAT_CODE' &&
    hasExactParameterCount(url, 'wechatCode', 1) &&
    hasExactParameterCount(url, 'phoneCredential', 0)
  ) {
    return parseMiniappMessage({
      source,
      type,
      code: url.searchParams.getAll('wechatCode')[0],
    });
  }
  if (
    type === 'PHONE_CREDENTIAL' &&
    hasExactParameterCount(url, 'phoneCredential', 1) &&
    hasExactParameterCount(url, 'wechatCode', 0)
  ) {
    return parseMiniappMessage({
      source,
      type,
      credential: url.searchParams.getAll('phoneCredential')[0],
    });
  }
  return null;
}

function scrubUrlHandoff(url: URL): string {
  const clean = new URL(url.href);
  HANDOFF_PARAMETERS.forEach((parameter) =>
    clean.searchParams.delete(parameter),
  );
  return `${clean.pathname}${clean.search}${clean.hash}`;
}

export function createMiniappMessageHub(): MiniappMessageHub {
  let pending: MiniappMessage | null = null;
  let subscribers: readonly MiniappMessageSubscriber[] = [];

  function publish(message: MiniappMessage): void {
    if (subscribers.length === 0) {
      pending = message;
      return;
    }
    subscribers.forEach((subscriber) => subscriber(message));
  }

  function subscribe(subscriber: MiniappMessageSubscriber): () => void {
    subscribers = [...subscribers, subscriber];
    if (pending) {
      const message = pending;
      pending = null;
      subscriber(message);
    }
    return (): void => {
      subscribers = subscribers.filter((candidate) => candidate !== subscriber);
    };
  }

  return { publish, subscribe };
}

export const miniappMessageHub = createMiniappMessageHub();

export function installMiniappBridge(
  onMessage: (message: MiniappMessage) => void,
  options: Readonly<{ enableWindowMessages?: boolean }> = {},
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const currentUrl = new URL(window.location.href);
  const handoff = parseUrlHandoff(currentUrl);
  const containsHandoff = HANDOFF_PARAMETERS.some((parameter) =>
    currentUrl.searchParams.has(parameter),
  );
  if (containsHandoff) {
    window.history.replaceState(
      window.history.state,
      '',
      scrubUrlHandoff(currentUrl),
    );
  }
  if (handoff) onMessage(handoff);

  if (!options.enableWindowMessages) return () => undefined;

  function listener(event: MessageEvent<unknown>): void {
    if (event.source !== window || event.origin !== window.location.origin)
      return;
    const message = parseMiniappMessage(event.data);
    if (message) onMessage(message);
  }

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export async function requestMiniappPhoneCredential(
  ensureJssdk: () => Promise<boolean> = ensureMiniProgramJssdk,
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!(await ensureJssdk())) return false;
  const navigator = window.wx?.miniProgram;
  if (typeof navigator?.navigateTo !== 'function') return false;

  const url = `${PHONE_AUTH_ROUTE}${encodeURIComponent(window.location.href)}`;
  if (url.length > MAX_MINIAPP_PHONE_ROUTE_LENGTH) return false;

  return new Promise((resolve) => {
    try {
      navigator.navigateTo({
        url,
        success: () => resolve(true),
        fail: () => resolve(false),
      });
    } catch {
      resolve(false);
    }
  });
}

export function makeWechatCodeMessage(code: string): MiniappMessage {
  return { source: 'bake-miniapp', type: 'WECHAT_CODE', code };
}

export const DEVELOPMENT_LOGIN_HINT = {
  phone: '13800000000',
  code: '123456',
} as const;
