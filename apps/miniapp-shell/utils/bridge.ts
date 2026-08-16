export const MINIAPP_MESSAGE_SOURCE = 'bake-miniapp' as const;
export const MINIAPP_SOURCE_PARAM = 'miniappSource' as const;
export const MINIAPP_TYPE_PARAM = 'miniappType' as const;
export const WECHAT_CODE_PARAM = 'wechatCode' as const;
export const WECHAT_STATE_PARAM = 'wechatState' as const;
export const PHONE_CREDENTIAL_PARAM = 'phoneCredential' as const;
export const AUTO_WECHAT_LOGIN_PARAM = 'miniappAutoWechatLogin' as const;

const HANDOFF_PARAMETERS = [
  MINIAPP_SOURCE_PARAM,
  MINIAPP_TYPE_PARAM,
  WECHAT_CODE_PARAM,
  WECHAT_STATE_PARAM,
  PHONE_CREDENTIAL_PARAM,
] as const;
const MALFORMED_PERCENT = /%(?![0-9a-fA-F]{2})/;
const HTTPS_URL_PATTERN = /^https:\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
const DNS_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
const IPV6_AUTHORITY_PATTERN = /^(\[[0-9a-f:.]+\])(?::([0-9]+))?$/i;
const DNS_AUTHORITY_PATTERN = /^([^:]+)(?::([0-9]+))?$/;

export type PhoneCredentialHandoff = Readonly<{
  credential: string;
  returnUrl: string;
}>;

export type WechatLoginHandoff = Readonly<{
  code: string;
  returnUrl: string;
  state: string;
}>;

export type PhoneAuthorizationDetail = Readonly<{
  code?: unknown;
  errMsg?: unknown;
  errno?: unknown;
}>;

type MemoryHandoffStore<T> = Readonly<{
  consume: (expected: T) => boolean;
  peek: () => T | null;
  write: (handoff: T) => boolean;
}>;

export type PhoneCredentialHandoffStore =
  MemoryHandoffStore<PhoneCredentialHandoff>;
export type WechatLoginHandoffStore = MemoryHandoffStore<WechatLoginHandoff>;

type ParsedHttpsUrl = Readonly<{
  hash: string;
  href: string;
  origin: string;
  pathname: string;
  query: string;
}>;

type IndexPageControllerDependencies = Readonly<{
  baseOrigin: string;
  baseUrl: string;
  consumePhoneHandoff: (expected: PhoneCredentialHandoff) => boolean;
  consumeWechatLoginHandoff: (expected: WechatLoginHandoff) => boolean;
  peekPhoneHandoff: () => PhoneCredentialHandoff | null;
  peekWechatLoginHandoff: () => WechatLoginHandoff | null;
  rebuildWebView: (url: string, deliveryId: string) => boolean;
  toast: (message: string) => void;
}>;

type PendingDelivery =
  | Readonly<{
      deliveryId: string;
      handoff: PhoneCredentialHandoff;
      type: 'phone';
    }>
  | Readonly<{
      deliveryId: string;
      handoff: WechatLoginHandoff;
      type: 'wechat-login';
    }>;

type PhoneAuthControllerDependencies = Readonly<{
  returnUrl: string;
  writeHandoff: (handoff: PhoneCredentialHandoff) => boolean;
  navigateBack: () => void;
  toast: (message: string) => void;
}>;

type WechatLoginControllerDependencies = Readonly<{
  login: () => Promise<unknown>;
  navigateBack: () => void;
  returnUrl: string;
  state: string;
  toast: (message: string) => void;
  writeHandoff: (handoff: WechatLoginHandoff) => boolean;
}>;

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function requireNonEmptyString(value: unknown, field: string): string {
  const normalized = parseNonEmptyString(value);
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

function normalizeAuthority(authority: string): string | null {
  if (!authority || authority.includes('@')) return null;
  const ipv6Match = authority.match(IPV6_AUTHORITY_PATTERN);
  const dnsMatch = authority.match(DNS_AUTHORITY_PATTERN);
  const match = ipv6Match ?? dnsMatch;
  if (!match) return null;

  const host = match[1]?.toLowerCase() ?? '';
  const portText = match[2];
  if (!host || (!host.startsWith('[') && !DNS_HOST_PATTERN.test(host))) {
    return null;
  }
  if (!portText) return host;

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return port === 443 ? host : `${host}:${port}`;
}

function containsControlOrSpace(value: string): boolean {
  return Array.from(value).some(
    (character) => (character.codePointAt(0) ?? 0) <= 32,
  );
}

function containsControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function hasUnsafeEncodedContent(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value);
    return (
      decoded.includes('\\') ||
      containsControl(decoded) ||
      /%[0-9a-fA-F]{2}/.test(decoded)
    );
  } catch {
    return true;
  }
}

function parseHttpsUrl(value: string): ParsedHttpsUrl | null {
  const normalized = value.trim();
  if (
    !normalized ||
    MALFORMED_PERCENT.test(normalized) ||
    containsControlOrSpace(normalized) ||
    hasUnsafeEncodedContent(normalized)
  ) {
    return null;
  }
  const match = normalized.match(HTTPS_URL_PATTERN);
  if (!match) return null;

  const authority = normalizeAuthority(match[1] ?? '');
  const rawPathname = match[2] ?? '';
  if (
    !authority ||
    (rawPathname && !rawPathname.startsWith('/')) ||
    rawPathname.includes('\\')
  ) {
    return null;
  }

  const pathname = rawPathname || '/';
  const query = match[3] ?? '';
  const hash = match[4] ?? '';
  const origin = `https://${authority}`;
  return {
    hash,
    href: `${origin}${pathname}${query}${hash}`,
    origin,
    pathname,
    query,
  };
}

function decodeQueryName(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

function clearHandoffQuery(query: string): string {
  if (!query) return '';
  const retained = query
    .slice(1)
    .split('&')
    .filter((entry) => {
      const separator = entry.indexOf('=');
      const rawName = separator === -1 ? entry : entry.slice(0, separator);
      const name = decodeQueryName(rawName);
      return name !== null && !HANDOFF_PARAMETERS.some((item) => item === name);
    });
  return retained.length > 0 ? `?${retained.join('&')}` : '';
}

function serializeHandoffParameters(
  parameters: ReadonlyArray<readonly [string, string]>,
): string {
  return parameters
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

function appendHandoffParameters(
  parsed: ParsedHttpsUrl,
  parameters: ReadonlyArray<readonly [string, string]>,
): string {
  const cleanQuery = clearHandoffQuery(parsed.query);
  const prefix = cleanQuery ? `${cleanQuery}&` : '?';
  return `${parsed.origin}${parsed.pathname}${prefix}${serializeHandoffParameters(parameters)}${parsed.hash}`;
}

function appendHandoffFragmentParameters(
  parsed: ParsedHttpsUrl,
  parameters: ReadonlyArray<readonly [string, string]>,
): string {
  const cleanFragment = clearHandoffQuery(
    parsed.hash ? `?${parsed.hash.slice(1)}` : '',
  ).slice(1);
  const prefix = cleanFragment ? `#${cleanFragment}&` : '#';
  return `${parsed.origin}${parsed.pathname}${parsed.query}${prefix}${serializeHandoffParameters(parameters)}`;
}

function requireSecureUrl(value: string): ParsedHttpsUrl {
  const parsed = parseHttpsUrl(value);
  if (!parsed) throw new Error('URL must use HTTPS without credentials');
  return parsed;
}

function samePhoneHandoff(
  left: PhoneCredentialHandoff,
  right: PhoneCredentialHandoff,
): boolean {
  return (
    left.credential === right.credential && left.returnUrl === right.returnUrl
  );
}

function sameWechatLoginHandoff(
  left: WechatLoginHandoff,
  right: WechatLoginHandoff,
): boolean {
  return (
    left.code === right.code &&
    left.returnUrl === right.returnUrl &&
    left.state === right.state
  );
}

function createMemoryHandoffStore<T>(
  normalize: (handoff: T) => T | null,
  equals: (left: T, right: T) => boolean,
): MemoryHandoffStore<T> {
  let current: T | null = null;

  function write(handoff: T): boolean {
    const normalized = normalize(handoff);
    if (!normalized) return false;
    current = normalized;
    return true;
  }

  function peek(): T | null {
    return current;
  }

  function consume(expected: T): boolean {
    if (!current || !equals(current, expected)) return false;
    current = null;
    return true;
  }

  return { consume, peek, write };
}

export function parseLoginCode(value: unknown): string | null {
  return parseNonEmptyString(value);
}

export function parsePhoneCredential(
  detail: PhoneAuthorizationDetail,
): string | null {
  if (
    detail.errMsg !== 'getPhoneNumber:ok' ||
    (detail.errno !== undefined && detail.errno !== 0)
  ) {
    return null;
  }
  return parseNonEmptyString(detail.code);
}

export function decodeRouteParameter(value: unknown): string | null {
  const normalized = parseNonEmptyString(value);
  if (!normalized || MALFORMED_PERCENT.test(normalized)) return null;
  if (/^https:\/\//i.test(normalized)) return normalized;

  try {
    const decoded = decodeURIComponent(normalized);
    return /^https:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function buildLoginHandoffUrl(
  baseUrl: string,
  code: unknown,
  state: unknown,
): string {
  const parsed = requireSecureUrl(baseUrl);
  return appendHandoffFragmentParameters(parsed, [
    [MINIAPP_SOURCE_PARAM, MINIAPP_MESSAGE_SOURCE],
    [MINIAPP_TYPE_PARAM, 'WECHAT_CODE'],
    [WECHAT_CODE_PARAM, requireNonEmptyString(code, 'login code')],
    [WECHAT_STATE_PARAM, requireNonEmptyString(state, 'login state')],
  ]);
}

export function validateReturnUrl(
  returnUrl: string,
  baseOrigin: string,
): string | null {
  const candidate = parseHttpsUrl(returnUrl);
  const trustedOrigin = parseHttpsUrl(baseOrigin);
  return candidate && trustedOrigin && candidate.origin === trustedOrigin.origin
    ? candidate.href
    : null;
}

function resolveTrustedReturnUrl(
  routeParameter: unknown,
  baseOrigin: string,
): string | null {
  const decoded = decodeRouteParameter(routeParameter);
  return decoded ? validateReturnUrl(decoded, baseOrigin) : null;
}

export {
  resolveTrustedReturnUrl as resolvePhoneAuthReturnUrl,
  resolveTrustedReturnUrl as resolveWechatLoginReturnUrl,
};

export function buildPhoneCredentialHandoffUrl(
  returnUrl: string,
  baseOrigin: string,
  credential: unknown,
): string {
  const trustedReturnUrl = validateReturnUrl(returnUrl, baseOrigin);
  if (!trustedReturnUrl) throw new Error('return URL is not allowed');

  return appendHandoffParameters(requireSecureUrl(trustedReturnUrl), [
    [MINIAPP_SOURCE_PARAM, MINIAPP_MESSAGE_SOURCE],
    [MINIAPP_TYPE_PARAM, 'PHONE_CREDENTIAL'],
    [
      PHONE_CREDENTIAL_PARAM,
      requireNonEmptyString(credential, 'phone credential'),
    ],
  ]);
}

export function createPhoneCredentialHandoffStore(): PhoneCredentialHandoffStore {
  return createMemoryHandoffStore((handoff) => {
    const credential = parseNonEmptyString(handoff.credential);
    const returnUrl = parseNonEmptyString(handoff.returnUrl);
    return credential && returnUrl ? { credential, returnUrl } : null;
  }, samePhoneHandoff);
}

export function createWechatLoginHandoffStore(): WechatLoginHandoffStore {
  return createMemoryHandoffStore((handoff) => {
    const code = parseLoginCode(handoff.code);
    const returnUrl = parseNonEmptyString(handoff.returnUrl);
    const state = parseNonEmptyString(handoff.state);
    return code && returnUrl && state ? { code, returnUrl, state } : null;
  }, sameWechatLoginHandoff);
}

export function createIndexPageController(
  dependencies: IndexPageControllerDependencies,
): Readonly<{
  handleLoginFailure: () => false;
  handleLoginSuccess: (code: unknown) => boolean;
  handleShow: () => boolean;
  handleWebViewError: (deliveryId: unknown) => boolean;
  handleWebViewLoad: (deliveryId: unknown) => boolean;
}> {
  let baseUrlLoaded = false;
  let explicitLoginObserved = false;
  let generation = 0;
  let pendingDelivery: PendingDelivery | null = null;

  function rebuild(url: string, deliveryId = ''): boolean {
    try {
      const rebuilt = dependencies.rebuildWebView(url, deliveryId);
      if (rebuilt && !deliveryId) {
        baseUrlLoaded = true;
        pendingDelivery = null;
      }
      return rebuilt;
    } catch {
      return false;
    }
  }

  function createDeliveryId(): string {
    generation += 1;
    return `delivery-${generation}`;
  }

  function hasExplicitLogin(): boolean {
    return (
      explicitLoginObserved ||
      dependencies.peekWechatLoginHandoff() !== null ||
      pendingDelivery?.type === 'wechat-login'
    );
  }

  function handleLoginSuccess(code: unknown): boolean {
    if (hasExplicitLogin()) return false;
    const normalized = parseLoginCode(code);
    if (!normalized) {
      dependencies.toast('微信登录暂不可用，请稍后重试');
      rebuild(dependencies.baseUrl);
      return false;
    }
    dependencies.toast('微信登录状态已失效，请重新登录');
    rebuild(dependencies.baseUrl);
    return false;
  }

  function handleLoginFailure(): false {
    if (!hasExplicitLogin()) {
      dependencies.toast('微信登录失败，请稍后重试');
      rebuild(dependencies.baseUrl);
    }
    return false;
  }

  function deliverWechatLogin(handoff: WechatLoginHandoff): boolean {
    const trustedReturnUrl = validateReturnUrl(
      handoff.returnUrl,
      dependencies.baseOrigin,
    );
    if (!trustedReturnUrl) {
      dependencies.toast('微信登录返回地址无效');
      return false;
    }
    const deliveryId = createDeliveryId();
    const rebuilt = rebuild(
      buildLoginHandoffUrl(trustedReturnUrl, handoff.code, handoff.state),
      deliveryId,
    );
    if (rebuilt) {
      pendingDelivery = { deliveryId, handoff, type: 'wechat-login' };
    }
    return rebuilt;
  }

  function deliverPhone(handoff: PhoneCredentialHandoff): boolean {
    try {
      const deliveryId = createDeliveryId();
      const rebuilt = rebuild(
        buildPhoneCredentialHandoffUrl(
          handoff.returnUrl,
          dependencies.baseOrigin,
          handoff.credential,
        ),
        deliveryId,
      );
      if (rebuilt) pendingDelivery = { deliveryId, handoff, type: 'phone' };
      return rebuilt;
    } catch {
      dependencies.toast('手机号授权返回地址无效');
      return false;
    }
  }

  function handleShow(): boolean {
    const loginHandoff = dependencies.peekWechatLoginHandoff();
    if (loginHandoff) {
      explicitLoginObserved = true;
      return deliverWechatLogin(loginHandoff);
    }
    const phoneHandoff = dependencies.peekPhoneHandoff();
    if (phoneHandoff) return deliverPhone(phoneHandoff);
    return baseUrlLoaded ? false : rebuild(dependencies.baseUrl);
  }

  function handleWebViewLoad(deliveryId: unknown): boolean {
    const normalized = parseNonEmptyString(deliveryId);
    if (!pendingDelivery || normalized !== pendingDelivery.deliveryId) {
      return false;
    }
    const delivery = pendingDelivery;
    const consumed =
      delivery.type === 'wechat-login'
        ? dependencies.consumeWechatLoginHandoff(delivery.handoff)
        : dependencies.consumePhoneHandoff(delivery.handoff);
    if (consumed) pendingDelivery = null;
    return consumed;
  }

  function handleWebViewError(deliveryId: unknown): boolean {
    const normalized = parseNonEmptyString(deliveryId);
    return Boolean(
      pendingDelivery && normalized === pendingDelivery.deliveryId,
    );
  }

  return {
    handleLoginFailure,
    handleLoginSuccess,
    handleShow,
    handleWebViewError,
    handleWebViewLoad,
  };
}

export function createWechatLoginController(
  dependencies: WechatLoginControllerDependencies,
): Readonly<{
  handleLogin: () => Promise<boolean>;
}> {
  async function handleLogin(): Promise<boolean> {
    try {
      const code = parseLoginCode(await dependencies.login());
      const stored = code
        ? dependencies.writeHandoff({
            code,
            returnUrl: dependencies.returnUrl,
            state: dependencies.state,
          })
        : false;
      if (!stored) {
        dependencies.toast('微信登录失败，请重试');
        return false;
      }
      dependencies.navigateBack();
      return true;
    } catch {
      dependencies.toast('微信登录失败，请重试');
      return false;
    }
  }

  return { handleLogin };
}

export function createPhoneAuthController(
  dependencies: PhoneAuthControllerDependencies,
): Readonly<{
  handleAuthorization: (detail: PhoneAuthorizationDetail) => boolean;
}> {
  function handleAuthorization(detail: PhoneAuthorizationDetail): boolean {
    const credential = parsePhoneCredential(detail);
    const stored = credential
      ? dependencies.writeHandoff({
          credential,
          returnUrl: dependencies.returnUrl,
        })
      : false;
    if (!stored) {
      dependencies.toast('未完成手机号授权');
      return false;
    }
    dependencies.navigateBack();
    return true;
  }

  return { handleAuthorization };
}
