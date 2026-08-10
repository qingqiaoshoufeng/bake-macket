import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import environmentHelpers from './scripts/e2e-environment.cjs';

const { buildE2eUrls, parseEnvFile } = environmentHelpers;
const repositoryRoot = __dirname;

function loadDevelopmentEnvironment(): Readonly<Record<string, string>> {
  try {
    return parseEnvFile(
      readFileSync(resolve(repositoryRoot, '.env.development'), 'utf8'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

const environment = { ...loadDevelopmentEnvironment(), ...process.env };
const { apiUrl, h5Url, adminUrl } = buildE2eUrls(environment);
const useExistingServers = environment.E2E_USE_EXISTING_SERVERS === '1';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/*.test.mjs'],
  forbidOnly: Boolean(environment.CI),
  fullyParallel: false,
  retries: environment.CI ? 2 : 0,
  workers: 1,
  reporter: environment.CI ? 'list' : 'html',
  use: {
    baseURL: h5Url,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: useExistingServers
    ? undefined
    : [
        {
          command: 'pnpm --filter @bake-mall/api start:dev',
          url: `${apiUrl}/api/v1/health`,
          name: 'api',
          timeout: 120_000,
          reuseExistingServer: false,
          cwd: repositoryRoot,
          env: environment,
        },
        {
          command: 'pnpm --filter @bake-mall/h5-store dev',
          url: h5Url,
          name: 'h5-store',
          timeout: 120_000,
          reuseExistingServer: false,
          cwd: repositoryRoot,
          env: environment,
        },
        {
          command: 'pnpm --filter @bake-mall/admin-web dev',
          url: adminUrl,
          name: 'admin-web',
          timeout: 120_000,
          reuseExistingServer: false,
          cwd: repositoryRoot,
          env: environment,
        },
      ],
});
