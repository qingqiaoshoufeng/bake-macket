import { URL } from 'node:url';

/** @param {string | undefined} value */
export function requireHttpsH5Url(value) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error('MINIAPP_H5_URL is required');
  }
  if (/%(?![0-9a-fA-F]{2})/.test(normalized)) {
    throw new Error('MINIAPP_H5_URL contains malformed percent encoding');
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('MINIAPP_H5_URL must be an absolute HTTPS URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('MINIAPP_H5_URL must use HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('MINIAPP_H5_URL must not include credentials');
  }
  if (parsed.pathname !== '/') {
    throw new Error('MINIAPP_H5_URL must use the root pathname /');
  }

  return /** @type {URL} */ (parsed).href;
}

/** @param {string | undefined} value */
export function resolveBuildH5Url(value) {
  return requireHttpsH5Url(value);
}

/** @param {string | undefined} value */
/** @param {string} value */
function serializeJavaScriptString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

/** @param {string | undefined} value */
export function createMiniappConfigSources(value) {
  const h5Url = requireHttpsH5Url(value);
  const origin = new URL(h5Url).origin;
  const serializedUrl = serializeJavaScriptString(h5Url);
  const serializedOrigin = serializeJavaScriptString(origin);
  return {
    h5: `export const MINIAPP_H5_URL = '${serializedUrl}';\nexport const MINIAPP_H5_ORIGIN = '${serializedOrigin}';\n`,
    api: `export const MINIAPP_API_BASE_URL = '${serializedOrigin}/api/v1';\n`,
  };
}

/** @param {string | undefined} value */
export function createMiniappConfigSource(value) {
  return createMiniappConfigSources(value).h5;
}
