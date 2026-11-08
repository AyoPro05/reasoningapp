import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './vitest.workspace-aliases.js';

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
