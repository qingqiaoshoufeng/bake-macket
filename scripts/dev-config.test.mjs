import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const rootPackage = readJson('package.json');
const apiPackage = readJson('apps/api/package.json');
const apiBuildConfig = readJson('apps/api/tsconfig.build.json');
const h5ViteConfig = readFileSync('apps/h5-store/vite.config.ts', 'utf8');
const adminViteConfig = readFileSync('apps/admin-web/vite.config.ts', 'utf8');
const composeScript = readFileSync('scripts/compose.mjs', 'utf8');
const developmentEnvTemplate = readFileSync('.env.development.example', 'utf8');
const productionEnvTemplate = readFileSync('.env.production.example', 'utf8');

assert.equal(
  rootPackage.scripts.dev,
  'pnpm services:up && pnpm --filter @bake-mall/contracts build && pnpm --filter @bake-mall/api migration:run && pnpm -r --parallel --stream dev',
);
assert.equal(apiPackage.scripts.dev, 'nest start --watch');
assert.equal(
  apiBuildConfig.compilerOptions.tsBuildInfoFile,
  './dist/tsconfig.build.tsbuildinfo',
);
assert.match(h5ViteConfig, /strictPort:\s*true/);
assert.match(h5ViteConfig, /H5_PORT/);
assert.match(h5ViteConfig, /\.\.\.process\.env/);
assert.match(h5ViteConfig, /12fg2re344234\.vicp\.fun/);
assert.match(h5ViteConfig, /MINIO_API_PORT/);
assert.match(
  h5ViteConfig,
  /'\/bake-mall\/':\s*\{[\s\S]*?target: `http:\/\/127\.0\.0\.1:\$\{minioPort\}`/u,
);
assert.match(adminViteConfig, /strictPort:\s*true/);
assert.match(adminViteConfig, /ADMIN_PORT/);
assert.match(adminViteConfig, /\.\.\.process\.env/);
assert.match(adminViteConfig, /12fg2re344234\.vicp\.fun/);
assert.match(adminViteConfig, /MINIO_API_PORT/);
assert.match(
  adminViteConfig,
  /'\/bake-mall\/':\s*\{[\s\S]*?target: `http:\/\/127\.0\.0\.1:\$\{minioPort\}`/u,
);
assert.match(composeScript, /--env-file/);
assert.match(
  developmentEnvTemplate,
  /^ADMIN_OPERATION_IDEMPOTENCY_SECRET=dev-only-admin-operation-idempotency-secret-do-not-use-in-prod$/mu,
);
assert.match(
  productionEnvTemplate,
  /^ADMIN_OPERATION_IDEMPOTENCY_SECRET=REPLACE_WITH_UNIQUE_ADMIN_OPERATION_IDEMPOTENCY_SECRET_AT_LEAST_32_CHARACTERS$/mu,
);
assert.match(
  productionEnvTemplate,
  /Emergency 0010\/0011 rollback confirmations only\. Keep all three at 0 in persistent configuration; never leave any at 1\./u,
);
assert.match(productionEnvTemplate, /^BAKE_MALL_IDENTITY_WRITERS_STOPPED=0$/mu);
assert.match(productionEnvTemplate, /^BAKE_MALL_PRINTING_WRITERS_STOPPED=0$/mu);
