import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Vite configuration for the merchant admin SPA.
 *
 * - Uses `@vitejs/plugin-vue` for SFC compilation.
 * - Resolves `@bake-mall/contracts` directly against the TypeScript source of
 *   the shared package so changes propagate without rebuilding the package.
 * - Produces a relative-asset SPA under `dist/` so the bundle can be hosted
 *   from any path (the production deploy hosts the admin behind a CDN
 *   sub-path).
 */
export default defineConfig({
  plugins: [vue()],
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
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
});
