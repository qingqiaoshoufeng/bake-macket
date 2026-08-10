import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

const swcPlugin = swc.vite({
  module: { type: 'es6' },
  jsc: {
    target: 'es2022',
    parser: {
      syntax: 'typescript',
      decorators: true,
      dynamicImport: true,
    },
    transform: {
      legacyDecorator: true,
      decoratorMetadata: true,
      useDefineForClassFields: false,
    },
    keepClassNames: true,
  },
});

export default defineConfig({
  plugins: [swcPlugin],
  test: {
    globals: false,
    environment: 'node',
    include: [
      'test/**/*.e2e-spec.ts',
      'test/fakes/**/*.spec.ts',
      'src/**/*.spec.ts',
    ],
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
