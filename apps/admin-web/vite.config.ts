import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const allowedHosts = ['12297oy2ga916.vicp.fun', '12fg2re344234.vicp.fun'];

/**
 * Vite configuration for the merchant admin SPA.
 * Shared contracts resolve directly to source so workspace changes are instant.
 */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repositoryRoot, ''), ...process.env };
  const apiPort = Number(env.PORT || 43015);
  const minioPort = Number(env.MINIO_API_PORT || 43900);

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
      port: Number(env.ADMIN_PORT || 43174),
      strictPort: true,
      allowedHosts,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
        // 公开对象存储代理：本地浏览器与花生壳指向 43174 时可直接拉到 MinIO 文件。
        '/bake-mall/': {
          target: `http://127.0.0.1:${minioPort}`,
          changeOrigin: true,
          ws: false,
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
