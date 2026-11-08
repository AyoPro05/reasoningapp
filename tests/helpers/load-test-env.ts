import { loadEnvFile } from 'node:process';

/** CI inherits its environment; an ignored local file is an optional fallback. */
export function loadOptionalTestEnv(path = '.env.test'): void {
  try { loadEnvFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
