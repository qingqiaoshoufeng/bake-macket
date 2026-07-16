import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const rootPackage = readJson('package.json');
const apiPackage = readJson('apps/api/package.json');
const apiBuildConfig = readJson('apps/api/tsconfig.build.json');
const h5ViteConfig = readFileSync('apps/h5-store/vite.config.ts', 'utf8');
const adminViteConfig = readFileSync('apps/admin-web/vite.config.ts', 'utf8');

assert.equal(
  rootPackage.scripts.dev,
  'pnpm services:up && pnpm --filter @bake-mall/api migration:run && pnpm -r --parallel --stream dev',
);
assert.equal(apiPackage.scripts.dev, 'nest start --watch');
assert.equal(
  apiBuildConfig.compilerOptions.tsBuildInfoFile,
  './dist/tsconfig.build.tsbuildinfo',
);
assert.match(h5ViteConfig, /strictPort:\s*true/);
assert.match(adminViteConfig, /strictPort:\s*true/);
