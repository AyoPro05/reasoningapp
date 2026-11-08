import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: {
    '@reasoningapp/question-render-spec': fileURLToPath(new URL('./packages/question-render-spec/src/index.ts', import.meta.url)),
  } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/content/**/*.test.ts', 'tests/security/**/*.test.ts'],
    passWithNoTests: false,
    clearMocks: true,
    maxWorkers: 2,
  },
});
