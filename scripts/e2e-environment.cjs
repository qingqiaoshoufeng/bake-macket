'use strict';

function parseEnvFile(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator).trim();
        const rawValue = line.slice(separator + 1).trim();
        const quoted =
          (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
          (rawValue.startsWith("'") && rawValue.endsWith("'"));
        return [key, quoted ? rawValue.slice(1, -1) : rawValue];
      }),
  );
}

function normalizeBaseUrl(value, fallbackPort) {
  const url = new URL(value ?? `http://127.0.0.1:${fallbackPort}`);
  return `${url.origin}${url.pathname.replace(/\/api\/v1\/?$/u, '').replace(/\/$/u, '')}`;
}

function assertFrontendRoot(value, label) {
  const url = new URL(value);
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must use the domain root: ${value}`);
  }
  return url.origin;
}

function buildE2eUrls(environment) {
  const apiUrl = normalizeBaseUrl(
    environment.API_URL,
    environment.PORT ?? '43015',
  );
  const h5Value =
    environment.H5_URL ?? `http://127.0.0.1:${environment.H5_PORT ?? '43173'}`;
  const adminValue =
    environment.ADMIN_URL ??
    `http://127.0.0.1:${environment.ADMIN_PORT ?? '43174'}`;
  return {
    apiUrl,
    h5Url: assertFrontendRoot(h5Value, 'H5_URL'),
    adminUrl: assertFrontendRoot(adminValue, 'ADMIN_URL'),
  };
}

function requireExistingServerEnvironment(environment) {
  if (environment.E2E_USE_EXISTING_SERVERS !== '1') return;
  if (!environment.DATABASE_URL) {
    throw new Error(
      'E2E_USE_EXISTING_SERVERS=1 requires DATABASE_URL for a disposable database.',
    );
  }
  const hasExplicitUrls = ['H5_URL', 'ADMIN_URL', 'API_URL'].every(
    (key) => environment[key],
  );
  const hasPorts = ['H5_PORT', 'ADMIN_PORT', 'PORT'].every(
    (key) => environment[key],
  );
  if (!hasExplicitUrls && !hasPorts) {
    throw new Error(
      'Existing-server mode requires H5_URL, ADMIN_URL, API_URL or H5_PORT, ADMIN_PORT, PORT.',
    );
  }
}

module.exports = {
  buildE2eUrls,
  parseEnvFile,
  requireExistingServerEnvironment,
};
