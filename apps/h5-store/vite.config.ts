import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const allowedHosts = ['12297oy2ga916.vicp.fun', '12fg2re344234.vicp.fun'];

/**
 * Vite configuration for the customer-facing mobile storefront.
 * Shared contracts resolve directly to source so workspace changes are instant.
 */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repositoryRoot, ''), ...process.env };
  const apiPort = Number(env.PORT || 43015);

  return {
    plugins: [vue()],
    envDir: repositoryRoot,
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
      host: env.HOST || '127.0.0.1',
      port: Number(env.H5_PORT || 43173),
      strictPort: true,
      allowedHosts,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    preview: { allowedHosts },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: true,
    },
  };
});
