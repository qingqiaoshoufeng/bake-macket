export function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

export function assertDomainRoot(base) {
  const url = new URL(base);
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Frontend URL must use the domain root: ${base}`);
  }
  return url;
}

export function resolveRootUrl(base, relative) {
  const root = assertDomainRoot(base);
  const path = String(relative).replace(/^\/+/, '');
  return new URL(path, ensureTrailingSlash(root.href)).href.replace(/\/$/, '');
}
