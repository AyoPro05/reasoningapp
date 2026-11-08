import { fileURLToPath } from 'node:url';

// Tests always exercise live workspace source, including in physical-copy sandboxes.
export const workspaceAliases = Object.fromEntries([
  'contracts', 'config', 'design-tokens', 'question-render-spec', 'question-validation', 'scoring-engine', 'database',
].map(name => [`@reasoningapp/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))]));
