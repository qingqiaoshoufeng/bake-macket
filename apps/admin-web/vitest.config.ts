import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/**
 * Vitest configuration for the merchant admin SPA.
 *
 * Pinia stores interact with `window.sessionStorage` and the shared
 * `ApiClient` reaches for `fetch`, so the default `node` environment isn't
 * enough — we switch every test to `jsdom`. The SFC/component tests added in
 * later tasks (Task 12) continue to run under the same browser-shaped
 * globals.
 */
export default defineConfig({
  // Vitest bundles its own (newer) Vite as a runtime dependency; the Vue
  // plugin returns types pinned to the Vite version declared by
  // `@vitejs/plugin-vue`, so the otherwise-mismatched `Plugin` shapes pass
  // through a deliberate `unknown` bridge here.
  plugins: [vue() as unknown as never],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@bake-mall/contracts': fileURLToPath(
        new URL(
          '../../packages/shared-contracts/src/index.ts',
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    globals: false,
    css: false,
  },
});
