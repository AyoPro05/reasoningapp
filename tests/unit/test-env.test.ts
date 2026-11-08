import { expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { loadOptionalTestEnv } from '../helpers/load-test-env.js';

test('integration env loading tolerates an absent ignored file and preserves inherited CI values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reasoningapp-env-'));
  const key = 'REASONINGAPP_ENV_TEST_SENTINEL';
  const original = process.env[key];
  try {
    expect(() => loadOptionalTestEnv(join(directory, 'absent.env'))).not.toThrow();
    const path = join(directory, 'sample.env');
    writeFileSync(path, `${key}=file-value\n`);
    process.env[key] = 'ci-value';
    loadOptionalTestEnv(path);
    expect(process.env[key]).toBe('ci-value');
    // Invalid argument errors must not be silently treated as a missing file.
    expect(() => loadOptionalTestEnv(`${path}\0`)).toThrow();
  } finally {
    if (original === undefined) delete process.env[key]; else process.env[key] = original;
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('reasoningapp-env-')) throw new Error('Unsafe temporary test directory');
    rmSync(target, { recursive: true, force: true });
  }
});
