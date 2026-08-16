import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import test from 'node:test';

const developmentEnv = readFileSync(
  new URL('../.env.development', import.meta.url),
  'utf8',
);
const developmentEnvTemplate = readFileSync(
  new URL('../.env.development.example', import.meta.url),
  'utf8',
);
const nginxConfig = readFileSync(
  new URL('../infra/nginx.conf', import.meta.url),
  'utf8',
);

const PUBLIC_BASE = 'https://12297oy2ga916.vicp.fun';

const readValue = (raw, key) => {
  const match = raw.match(new RegExp(`^${key}=(.*)$`, 'mu'));
  return match ? match[1].trim() : null;
};

test('development env points object storage public URL at vicp tunnel', () => {
  const publicBase = readValue(developmentEnv, 'OBJECT_STORAGE_PUBLIC_BASE_URL');
  const allowedOrigins = readValue(developmentEnv, 'PRODUCT_MEDIA_ALLOWED_ORIGINS');
  assert.equal(publicBase, `${PUBLIC_BASE}/bake-mall`);
  assert.equal(allowedOrigins, PUBLIC_BASE);
  assert.doesNotMatch(publicBase ?? '', /127\.0\.0\.1/);
  assert.doesNotMatch(allowedOrigins ?? '', /127\.0\.0\.1/);
});

test('development env template mirrors the same public URL', () => {
  const publicBase = readValue(
    developmentEnvTemplate,
    'OBJECT_STORAGE_PUBLIC_BASE_URL',
  );
  const allowedOrigins = readValue(
    developmentEnvTemplate,
    'PRODUCT_MEDIA_ALLOWED_ORIGINS',
  );
  assert.equal(publicBase, `${PUBLIC_BASE}/bake-mall`);
  assert.equal(allowedOrigins, PUBLIC_BASE);
});

test('nginx exposes the object storage reverse proxy at /bake-mall/', () => {
  assert.match(nginxConfig, /upstream bake_mall_minio \{/);
  assert.match(nginxConfig, /server minio:9000;/);
  const locationCount = (
    nginxConfig.match(/location \/bake-mall\/ \{/g) ?? []
  ).length;
  assert.equal(locationCount, 2);
  const proxyPassCount = (
    nginxConfig.match(/proxy_pass http:\/\/bake_mall_minio;/g) ?? []
  ).length;
  assert.equal(proxyPassCount, 2);
});