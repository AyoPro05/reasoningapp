import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './vitest.workspace-aliases.js';

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/content/**/*.test.ts', 'tests/security/**/*.test.ts'],
    passWithNoTests: false,
    clearMocks: true,
    maxWorkers: 2,
  },
});
