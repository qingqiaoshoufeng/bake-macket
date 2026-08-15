import { generateSecureUuidV4 } from '../utils/idempotency.js';
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
export const MAX_MINIAPP_WECHAT_LOGIN_ROUTE_LENGTH = 1024;

const PHONE_AUTH_ROUTE = '/pages/phone-auth/index?returnUrl=';
const WECHAT_LOGIN_ROUTE = '/pages/wechat-login/index?returnUrl=';
const WECHAT_LOGIN_STATE_STORAGE_KEY = 'bake_wechat_login_state';
const WECHAT_LOGIN_STATE_CREATED_AT_STORAGE_KEY =
  'bake_wechat_login_state_created_at';
const WECHAT_LOGIN_STATE_TTL_MS = 10 * 60 * 1_000;
const WECHAT_STATE_PARAMETER = 'wechatState';
const HANDOFF_PARAMETERS = [
  'miniappSource',
  'miniappType',
  'wechatCode',
  WECHAT_STATE_PARAMETER,
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
    return code && !Object.prototype.hasOwnProperty.call(record, 'credential')
      ? { source: 'bake-miniapp', type: 'WECHAT_CODE', code }
      : null;
  }
  if (record.type === 'PHONE_CREDENTIAL') {
    const credential = parseNonEmptyString(record.credential);
    return credential && !Object.prototype.hasOwnProperty.call(record, 'code')
      ? { source: 'bake-miniapp', type: 'PHONE_CREDENTIAL', credential }
      : null;
  }
  return null;
}

function containsMalformedPercent(value: string): boolean {
  return /%(?![0-9a-fA-F]{2})/.test(value);
}

function hasExactParameterCount(
  parameters: URLSearchParams,
  parameter: (typeof HANDOFF_PARAMETERS)[number],
  count: number,
): boolean {
  return parameters.getAll(parameter).length === count;
}

function clearStoredWechatLoginState(): void {
  window.localStorage.removeItem(WECHAT_LOGIN_STATE_STORAGE_KEY);
  window.localStorage.removeItem(WECHAT_LOGIN_STATE_CREATED_AT_STORAGE_KEY);
}

function consumeWechatLoginState(state: string | null): boolean {
  if (!state) return false;
  try {
    const pending = window.localStorage.getItem(WECHAT_LOGIN_STATE_STORAGE_KEY);
    const createdAt = Number(
      window.localStorage.getItem(WECHAT_LOGIN_STATE_CREATED_AT_STORAGE_KEY),
    );
    const fresh =
      Number.isFinite(createdAt) &&
      createdAt > 0 &&
      Date.now() - createdAt <= WECHAT_LOGIN_STATE_TTL_MS;
    if (!pending || pending !== state || !fresh) {
      clearStoredWechatLoginState();
      return false;
    }
    clearStoredWechatLoginState();
    return true;
  } catch {
    return false;
  }
}

function fragmentParameters(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '');
}

function parseWechatCodeHandoff(url: URL): MiniappMessage | null {
  if (containsMalformedPercent(url.hash)) return null;
  const parameters = fragmentParameters(url);
  if (
    parameters.getAll('miniappSource').length !== 1 ||
    parameters.getAll('miniappType').length !== 1 ||
    parameters.get('miniappSource') !== 'bake-miniapp' ||
    parameters.get('miniappType') !== 'WECHAT_CODE' ||
    !hasExactParameterCount(parameters, 'wechatCode', 1) ||
    !hasExactParameterCount(parameters, WECHAT_STATE_PARAMETER, 1) ||
    !hasExactParameterCount(parameters, 'phoneCredential', 0)
  ) {
    return null;
  }

  const state = parseNonEmptyString(
    parameters.getAll(WECHAT_STATE_PARAMETER)[0],
  );
  const message = parseMiniappMessage({
    source: 'bake-miniapp',
    type: 'WECHAT_CODE',
    code: parameters.getAll('wechatCode')[0],
  });
  return message && consumeWechatLoginState(state) ? message : null;
}

function parsePhoneCredentialHandoff(url: URL): MiniappMessage | null {
  if (containsMalformedPercent(url.search)) return null;
  const parameters = url.searchParams;
  if (
    parameters.getAll('miniappSource').length !== 1 ||
    parameters.getAll('miniappType').length !== 1 ||
    parameters.get('miniappSource') !== 'bake-miniapp' ||
    parameters.get('miniappType') !== 'PHONE_CREDENTIAL' ||
    !hasExactParameterCount(parameters, 'phoneCredential', 1) ||
    !hasExactParameterCount(parameters, 'wechatCode', 0)
  ) {
    return null;
  }
  return parseMiniappMessage({
    source: 'bake-miniapp',
    type: 'PHONE_CREDENTIAL',
    credential: parameters.getAll('phoneCredential')[0],
  });
}

function parseUrlHandoff(url: URL): MiniappMessage | null {
  return parseWechatCodeHandoff(url) ?? parsePhoneCredentialHandoff(url);
}

function scrubUrlHandoff(url: URL): string {
  const clean = new URL(url.href);
  HANDOFF_PARAMETERS.forEach((parameter) =>
    clean.searchParams.delete(parameter),
  );
  const fragmentContainsHandoff = HANDOFF_PARAMETERS.some((parameter) =>
    clean.hash.includes(`${parameter}=`),
  );
  if (!fragmentContainsHandoff) {
    return `${clean.pathname}${clean.search}${clean.hash}`;
  }
  const fragment = fragmentParameters(clean);
  HANDOFF_PARAMETERS.forEach((parameter) => fragment.delete(parameter));
  const cleanHash = fragment.toString();
  return `${clean.pathname}${clean.search}${cleanHash ? `#${cleanHash}` : ''}`;
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
  const fragment = fragmentParameters(currentUrl);
  const containsHandoff = HANDOFF_PARAMETERS.some(
    (parameter) =>
      currentUrl.searchParams.has(parameter) || fragment.has(parameter),
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

async function requestMiniappRoute(
  route: string,
  maxLength: number,
  ensureJssdk: () => Promise<boolean>,
  query = '',
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    if (!(await ensureJssdk())) return false;
  } catch {
    return false;
  }
  const navigator = window.wx?.miniProgram;
  if (typeof navigator?.navigateTo !== 'function') return false;

  const url = `${route}${encodeURIComponent(window.location.href)}${query}`;
  if (url.length > maxLength) return false;

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

export function requestMiniappPhoneCredential(
  ensureJssdk: () => Promise<boolean> = ensureMiniProgramJssdk,
): Promise<boolean> {
  return requestMiniappRoute(
    PHONE_AUTH_ROUTE,
    MAX_MINIAPP_PHONE_ROUTE_LENGTH,
    ensureJssdk,
  );
}

function writeWechatLoginState(state: string): boolean {
  try {
    window.localStorage.setItem(WECHAT_LOGIN_STATE_STORAGE_KEY, state);
    window.localStorage.setItem(
      WECHAT_LOGIN_STATE_CREATED_AT_STORAGE_KEY,
      String(Date.now()),
    );
    return true;
  } catch {
    return false;
  }
}

function clearWechatLoginState(expected: string): void {
  try {
    if (
      window.localStorage.getItem(WECHAT_LOGIN_STATE_STORAGE_KEY) === expected
    ) {
      clearStoredWechatLoginState();
    }
  } catch {
    // Storage failures leave no usable state for a later handoff.
  }
}

let latestWechatLoginAttempt = 0;

export async function requestMiniappWechatLogin(
  ensureJssdk: () => Promise<boolean> = ensureMiniProgramJssdk,
  options: Readonly<{
    automatic?: boolean;
    createState?: () => string;
  }> = {},
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  latestWechatLoginAttempt += 1;
  const attempt = latestWechatLoginAttempt;

  let ready: boolean;
  try {
    ready = await ensureJssdk();
  } catch {
    return false;
  }
  if (!ready || attempt !== latestWechatLoginAttempt) return false;

  let state: string;
  try {
    state = (options.createState ?? generateSecureUuidV4)().trim();
  } catch {
    return false;
  }
  if (!state || !writeWechatLoginState(state)) return false;

  const navigated = await requestMiniappRoute(
    WECHAT_LOGIN_ROUTE,
    MAX_MINIAPP_WECHAT_LOGIN_ROUTE_LENGTH,
    async () => attempt === latestWechatLoginAttempt,
    `&state=${encodeURIComponent(state)}${options.automatic ? '&automatic=1' : ''}`,
  );
  if (!navigated) clearWechatLoginState(state);
  return navigated;
}

export function makeWechatCodeMessage(code: string): MiniappMessage {
  return { source: 'bake-miniapp', type: 'WECHAT_CODE', code };
}

export const DEVELOPMENT_LOGIN_HINT = {
  phone: '13800000000',
  code: '123456',
} as const;
