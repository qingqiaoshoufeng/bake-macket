import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/capabilities/xinye-xp58iih.verified.spec.ts'],
    globals: false,
  },
});
