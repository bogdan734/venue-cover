import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['lib/**/*.test.ts', 'proxy.test.ts'], environment: 'node' },
});
