import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { enqueueAuthMail } from '../../apps/api/src/modules/auth/mail.js';
import { task3Database } from '../helpers/task3.js';

const { db, runId } = task3Database();
let connected = false;
beforeAll(async () => { await db.$queryRaw`SELECT 1`; connected = true; });
afterAll(async () => {
  try { if (connected) await db.outboxEvent.deleteMany({ where: { aggregateId: runId } }); }
  finally { await db.$disconnect(); }
});

async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test loopback port');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

type Observation = { kind: string; rejected?: boolean; clientsObserved?: number; connectionsEnded?: boolean };
function spawnOutage(mode: 'publisher' | 'worker', outboxId: string, port: number) {
  const child = fork(fileURLToPath(new URL('../helpers/worker-outage-child.mjs', import.meta.url)), [mode, outboxId], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), execArgv: ['--import', 'tsx'],
    env: { ...process.env, REDIS_URL: `redis://127.0.0.1:${port}/15` },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const observations: Observation[] = [];
  const observedAt = new Map<string, number>();
  const waiters = new Set<() => void>();
  let exited = false;
  let exitCode: number | null = null;
  let exitedAt: number | null = null;
  let spawnFailed = false;
  const wake = () => { for (const waiter of [...waiters]) waiter(); };
  child.on('message', message => {
    const observation = message as Observation;
    if (!observedAt.has(observation.kind)) observedAt.set(observation.kind, performance.now());
    observations.push(observation); wake();
  });
  child.on('error', () => { spawnFailed = true; wake(); });
  const exit = new Promise<void>(resolve => {
    child.once('exit', code => { exited = true; exitCode = code; exitedAt = performance.now(); wake(); resolve(); });
    child.once('error', () => { resolve(); });
  });
  // Deadline observation is test-only. Timers/listeners are removed on every
  // path; finally kills and REAPS a failing child before the test returns.
  async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    if (predicate()) return true;
    if (exited || spawnFailed) return false;
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const check = () => {
        if (!predicate() && !exited && !spawnFailed) return;
        clearTimeout(timer); waiters.delete(check); resolve(predicate());
      };
      timer = setTimeout(() => { waiters.delete(check); resolve(predicate()); }, timeoutMs);
      waiters.add(check);
    });
  }
  return {
    child, observations,
    get exitCode() { return exitCode; },
    get exitedAt() { return exitedAt; },
    observedAt(kind: string) { return observedAt.get(kind); },
    waitFor,
    async stopAndReap() {
      if (!exited) child.kill('SIGKILL');
      await exit;
    },
    has(kind: string) { return observations.some(message => message.kind === kind); },
  };
}

async function dueMail(key: string) {
  const row = await enqueueAuthMail(db, { userId: runId, recipient: `${runId}@example.invalid`, templateKey: 'auth.verifyEmail',
    url: `http://localhost:3001/api/auth/verify-email?token=synthetic-${key}-${runId}` });
  await db.outboxEvent.update({ where: { id: row.id }, data: { availableAt: new Date(0) } });
  return row;
}

test('Redis startup outage rejects due-row publication and releases actual producer connections within five seconds', async () => {
  const row = await dueMail('publisher');
  const harness = spawnOutage('publisher', row.id, await closedLoopbackPort());
  try {
    expect(await harness.waitFor(() => harness.has('publish-started'), 10_000)).toBe(true);
    const startedAt = harness.observedAt('publish-started')!;
    const remaining = () => Math.max(0, 5000 - (performance.now() - startedAt));
    expect(await harness.waitFor(() => harness.has('cleanup-finished'), remaining())).toBe(true);
    expect(harness.has('publication-rejected')).toBe(true);
    expect(harness.observations.some(message => message.kind === 'publish-settled' && message.rejected)).toBe(true);
    const cleanup = harness.observations.find(message => message.kind === 'cleanup-finished');
    expect((cleanup?.clientsObserved ?? 0) > 0).toBe(true);
    expect(cleanup?.connectionsEnded).toBe(true);
    const exitedNormally = await harness.waitFor(() => harness.exitCode === 0, remaining());
    const timing = { scenario: 'producer', budgetMs: 5000,
      cleanupMs: Math.round(harness.observedAt('cleanup-finished')! - startedAt),
      normalExitMs: harness.exitedAt === null ? null : Math.round(harness.exitedAt - startedAt) };
    expect(exitedNormally && harness.exitedAt !== null && harness.exitedAt - startedAt <= 5000,
      JSON.stringify({ ...timing, exitCode: harness.exitCode, observations: harness.observations })).toBe(true);
    console.info('Task 3 outage timing', JSON.stringify(timing));
  } finally { await harness.stopAndReap(); }
  const retained = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
  expect(retained.status).toBe('PENDING');
  expect(retained.attempts).toBe(0);
});

test('Redis startup outage SIGTERM interrupts an in-flight publication and closes the actual worker without losing its due row', async () => {
  const row = await dueMail('worker');
  // Parent fixture cleanup below prevents a previously due row from intercepting
  // the real worker's first publication in this isolated regression.
  await db.outboxEvent.updateMany({ where: { aggregateId: runId, id: { not: row.id } }, data: { availableAt: new Date(Date.now() + 60_000) } });
  const harness = spawnOutage('worker', row.id, await closedLoopbackPort());
  try {
    expect(await harness.waitFor(() => harness.has('publish-started'), 10_000)).toBe(true);
    // One monotonic total budget, including signal receipt, cleanup and normal
    // exit. This replaces the old independent 5s + 2s windows (7s in total).
    const startedAt = performance.now();
    const remaining = () => Math.max(0, 5000 - (performance.now() - startedAt));
    harness.child.send('terminate');
    expect(await harness.waitFor(() => harness.has('termination-emitted'), Math.min(2000, remaining()))).toBe(true);
    const cleanedUp = await harness.waitFor(() => harness.has('cleanup-finished'), remaining());
    if (!cleanedUp) {
      harness.child.send('inspect-shutdown');
      await harness.waitFor(() => harness.has('shutdown-status'), 1000);
    }
    // The original total-budget outcome is captured before diagnostics.
    expect(cleanedUp, JSON.stringify(harness.observations)).toBe(true);
    const cleanup = harness.observations.find(message => message.kind === 'cleanup-finished');
    expect((cleanup?.clientsObserved ?? 0) > 0).toBe(true);
    expect(cleanup?.connectionsEnded).toBe(true);
    const exitedNormally = await harness.waitFor(() => harness.exitCode === 0, remaining());
    const timing = { scenario: 'SIGTERM', budgetMs: 5000,
      cleanupMs: Math.round(harness.observedAt('cleanup-finished')! - startedAt),
      normalExitMs: harness.exitedAt === null ? null : Math.round(harness.exitedAt - startedAt) };
    expect(exitedNormally && harness.exitedAt !== null && harness.exitedAt - startedAt <= 5000,
      JSON.stringify({ ...timing, exitCode: harness.exitCode, observations: harness.observations })).toBe(true);
    console.info('Task 3 outage timing', JSON.stringify(timing));
  } finally { await harness.stopAndReap(); }
  const retained = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
  expect(retained.status).toBe('PENDING');
  expect(retained.attempts).toBe(0);
});
