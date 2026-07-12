import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts', 'src/**/*.spec.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@bake-mall/contracts': new URL(
        '../../packages/shared-contracts/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
});
