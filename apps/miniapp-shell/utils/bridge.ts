export const MINIAPP_MESSAGE_SOURCE = 'bake-miniapp' as const;
export const MINIAPP_SOURCE_PARAM = 'miniappSource' as const;
export const MINIAPP_TYPE_PARAM = 'miniappType' as const;
export const WECHAT_CODE_PARAM = 'wechatCode' as const;
export const PHONE_CREDENTIAL_PARAM = 'phoneCredential' as const;

const HANDOFF_PARAMETERS = [
  MINIAPP_SOURCE_PARAM,
  MINIAPP_TYPE_PARAM,
  WECHAT_CODE_PARAM,
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

export type PhoneAuthorizationDetail = Readonly<{
  code?: unknown;
  errMsg?: unknown;
  errno?: unknown;
}>;

export type PhoneCredentialHandoffStore = Readonly<{
  consume: (expected: PhoneCredentialHandoff) => boolean;
  peek: () => PhoneCredentialHandoff | null;
  write: (handoff: PhoneCredentialHandoff) => boolean;
}>;

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
  peekPhoneHandoff: () => PhoneCredentialHandoff | null;
  rebuildWebView: (url: string, deliveryId: string) => boolean;
  toast: (message: string) => void;
}>;

type PendingPhoneDelivery = Readonly<{
  deliveryId: string;
  handoff: PhoneCredentialHandoff;
}>;

type PhoneAuthControllerDependencies = Readonly<{
  returnUrl: string;
  writeHandoff: (handoff: PhoneCredentialHandoff) => boolean;
  navigateBack: () => void;
  toast: (message: string) => void;
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

function parseHttpsUrl(value: string): ParsedHttpsUrl | null {
  const normalized = value.trim();
  if (
    !normalized ||
    MALFORMED_PERCENT.test(normalized) ||
    containsControlOrSpace(normalized)
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

function appendHandoffParameters(
  parsed: ParsedHttpsUrl,
  parameters: ReadonlyArray<readonly [string, string]>,
): string {
  const cleanQuery = clearHandoffQuery(parsed.query);
  const prefix = cleanQuery ? `${cleanQuery}&` : '?';
  const handoff = parameters
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
  return `${parsed.origin}${parsed.pathname}${prefix}${handoff}${parsed.hash}`;
}

function requireSecureUrl(value: string): ParsedHttpsUrl {
  const parsed = parseHttpsUrl(value);
  if (!parsed) throw new Error('URL must use HTTPS without credentials');
  return parsed;
}

function sameHandoff(
  left: PhoneCredentialHandoff,
  right: PhoneCredentialHandoff,
): boolean {
  return (
    left.credential === right.credential && left.returnUrl === right.returnUrl
  );
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

export function buildLoginHandoffUrl(baseUrl: string, code: unknown): string {
  const parsed = requireSecureUrl(baseUrl);
  return appendHandoffParameters(parsed, [
    [MINIAPP_SOURCE_PARAM, MINIAPP_MESSAGE_SOURCE],
    [MINIAPP_TYPE_PARAM, 'WECHAT_CODE'],
    [WECHAT_CODE_PARAM, requireNonEmptyString(code, 'login code')],
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

export function resolvePhoneAuthReturnUrl(
  routeParameter: unknown,
  baseOrigin: string,
): string | null {
  const decoded = decodeRouteParameter(routeParameter);
  return decoded ? validateReturnUrl(decoded, baseOrigin) : null;
}

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
  let current: PhoneCredentialHandoff | null = null;

  function write(handoff: PhoneCredentialHandoff): boolean {
    const credential = parseNonEmptyString(handoff.credential);
    const returnUrl = parseNonEmptyString(handoff.returnUrl);
    if (!credential || !returnUrl) return false;
    current = { credential, returnUrl };
    return true;
  }

  function peek(): PhoneCredentialHandoff | null {
    return current;
  }

  function consume(expected: PhoneCredentialHandoff): boolean {
    if (!current || !sameHandoff(current, expected)) return false;
    current = null;
    return true;
  }

  return { consume, peek, write };
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
  let generation = 0;
  let pendingPhoneDelivery: PendingPhoneDelivery | null = null;

  function rebuild(url: string, deliveryId = ''): boolean {
    try {
      const rebuilt = dependencies.rebuildWebView(url, deliveryId);
      if (rebuilt && !deliveryId) pendingPhoneDelivery = null;
      return rebuilt;
    } catch {
      return false;
    }
  }

  function createDeliveryId(): string {
    generation += 1;
    return `delivery-${generation}`;
  }

  function handleLoginSuccess(code: unknown): boolean {
    const normalized = parseLoginCode(code);
    if (!normalized) {
      dependencies.toast('微信登录暂不可用，请稍后重试');
      rebuild(dependencies.baseUrl);
      return false;
    }
    return rebuild(buildLoginHandoffUrl(dependencies.baseUrl, normalized));
  }

  function handleLoginFailure(): false {
    dependencies.toast('微信登录失败，请稍后重试');
    rebuild(dependencies.baseUrl);
    return false;
  }

  function handleShow(): boolean {
    const handoff = dependencies.peekPhoneHandoff();
    if (!handoff) return false;
    try {
      const handoffUrl = buildPhoneCredentialHandoffUrl(
        handoff.returnUrl,
        dependencies.baseOrigin,
        handoff.credential,
      );
      const deliveryId = createDeliveryId();
      const rebuilt = rebuild(handoffUrl, deliveryId);
      if (rebuilt) pendingPhoneDelivery = { deliveryId, handoff };
      return rebuilt;
    } catch {
      dependencies.toast('手机号授权返回地址无效');
      return false;
    }
  }

  function handleWebViewLoad(deliveryId: unknown): boolean {
    const normalized = parseNonEmptyString(deliveryId);
    if (
      !pendingPhoneDelivery ||
      normalized !== pendingPhoneDelivery.deliveryId
    ) {
      return false;
    }
    const delivery = pendingPhoneDelivery;
    const consumed = dependencies.consumePhoneHandoff(delivery.handoff);
    if (consumed) pendingPhoneDelivery = null;
    return consumed;
  }

  function handleWebViewError(deliveryId: unknown): boolean {
    const normalized = parseNonEmptyString(deliveryId);
    return Boolean(
      pendingPhoneDelivery && normalized === pendingPhoneDelivery.deliveryId,
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
