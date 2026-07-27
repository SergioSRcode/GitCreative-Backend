import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    globalSetup: ['./src/test-global-setup.ts'],
    // Integration tests share one real database — running them in parallel
    // causes race conditions between different test files' cleanup queries.
    // Force sequential execution for correctness over speed.
    fileParallelism: false,
  },
});