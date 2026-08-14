import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const requiredFiles = [
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'eslint.config.mjs',
  '.env.example',
  '.env.development.example',
  '.env.production.example',
  'infra/docker-compose.dev.yml',
  'apps/merchant-terminal/package.json',
  'apps/merchant-terminal/src/manifest.json',
  'apps/merchant-terminal/src/pages.json',
  'apps/merchant-terminal/src/main.ts',
  'apps/merchant-terminal/src/App.vue',
];

for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Missing workspace file: ${file}`);
}

const tsconfig = JSON.parse(readFileSync('tsconfig.base.json', 'utf8'));
const compilerOptions = tsconfig.compilerOptions ?? {};

if (compilerOptions.noEmit === true) {
  throw new Error(
    'tsconfig.base.json must allow packages to emit build output',
  );
}

if (compilerOptions.lib?.includes('DOM')) {
  throw new Error(
    'tsconfig.base.json must not impose browser DOM types universally',
  );
}

const browserTsconfig = JSON.parse(
  readFileSync('tsconfig.browser.json', 'utf8'),
);
if (!browserTsconfig.compilerOptions?.lib?.includes('DOM')) {
  throw new Error(
    'tsconfig.browser.json must provide DOM types for browser applications',
  );
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
for (const dependency of ['eslint-plugin-vue', 'vue-eslint-parser']) {
  if (!packageJson.devDependencies?.[dependency]) {
    throw new Error(`Missing Vue ESLint dependency: ${dependency}`);
  }
  require.resolve(dependency);
}

if (!packageJson.scripts?.lint?.startsWith('eslint ')) {
  throw new Error('pnpm lint must run root ESLint so Vue SFCs are linted');
}

const apiPackageJson = JSON.parse(
  readFileSync('apps/api/package.json', 'utf8'),
);
if (!apiPackageJson.scripts?.test?.includes('--maxWorkers=1')) {
  throw new Error('API exact test command must run with --maxWorkers=1');
}
if (
  !apiPackageJson.scripts?.['test:e2e']?.includes('...process.argv.slice(1)')
) {
  throw new Error('API test:e2e command must append requested test files');
}

const eslintConfig = readFileSync('eslint.config.mjs', 'utf8');
for (const requiredSnippet of [
  'eslint-plugin-vue',
  'vue-eslint-parser',
  '**/*.vue',
]) {
  if (!eslintConfig.includes(requiredSnippet)) {
    throw new Error(`ESLint config must support Vue SFCs: ${requiredSnippet}`);
  }
}

const environment = Object.fromEntries(
  readFileSync('.env.development.example', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=', 2)),
);

const compose = readFileSync('infra/docker-compose.dev.yml', 'utf8');
for (const [variable, expected] of Object.entries({
  PORT: '43015',
  H5_PORT: '43173',
  ADMIN_PORT: '43174',
  MYSQL_PORT: '43306',
  MYSQL_PASSWORD: 'bake_app_password',
  OBJECT_STORAGE_ACCESS_KEY: 'minioadmin',
  OBJECT_STORAGE_SECRET_KEY: 'minioadmin',
})) {
  if (environment[variable] !== expected) {
    throw new Error(
      `.env.development.example ${variable} must match local defaults`,
    );
  }
}

for (const volume of ['mysql_data', 'minio_data']) {
  if (!compose.includes(`${volume}:`)) {
    throw new Error(
      `Docker Compose must declare the ${volume} persistent volume`,
    );
  }
}

console.log('workspace configuration is complete');
