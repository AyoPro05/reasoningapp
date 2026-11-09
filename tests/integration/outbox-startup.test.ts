import { fork } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
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

/** Actual TCP transport: accepts/reads startup bytes but never sends a Redis reply. */
async function silentRedisEndpoint() {
  const sockets = new Set<Socket>();
  const receivedStartup = new Set<Socket>();
  const waiters = new Set<() => void>();
  const wake = () => { for (const waiter of [...waiters]) waiter(); };
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('data', () => { receivedStartup.add(socket); wake(); });
    socket.once('close', () => { sockets.delete(socket); receivedStartup.delete(socket); wake(); });
    wake();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No silent test endpoint port');
  return {
    port: address.port,
    // Require live sockets that have sent actual startup commands, not merely
    // a race where SIGTERM happened before TCP connection/initialisation.
    waitForStartupConnections(count: number, timeoutMs: number): Promise<boolean> {
      if (receivedStartup.size >= count) return Promise.resolve(true);
      return new Promise(resolve => {
        const check = () => {
          if (receivedStartup.size < count) return;
          clearTimeout(timer); waiters.delete(check); resolve(true);
        };
        const timer = setTimeout(() => { waiters.delete(check); resolve(false); }, timeoutMs);
        waiters.add(check);
      });
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
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

test('Redis silent startup bounds actual producer publication and normal exit with its due row retained', async () => {
  const row = await dueMail('silent-publisher');
  const endpoint = await silentRedisEndpoint();
  let harness: ReturnType<typeof spawnOutage> | undefined;
  try {
    harness = spawnOutage('publisher', row.id, endpoint.port);
    const child = harness;
    expect(await child.waitFor(() => child.has('publish-started'), 10_000), JSON.stringify(child.observations)).toBe(true);
    const startedAt = child.observedAt('publish-started')!;
    const remaining = () => Math.max(0, 5000 - (performance.now() - startedAt));
    expect(await endpoint.waitForStartupConnections(1, remaining())).toBe(true);
    expect(await child.waitFor(() => child.has('cleanup-finished'), remaining()), JSON.stringify(child.observations)).toBe(true);
    expect(child.has('publication-rejected')).toBe(true);
    expect(child.observations.some(message => message.kind === 'publish-settled' && message.rejected)).toBe(true);
    const cleanup = child.observations.find(message => message.kind === 'cleanup-finished');
    expect((cleanup?.clientsObserved ?? 0) > 0).toBe(true);
    expect(cleanup?.connectionsEnded).toBe(true);
    const exitedNormally = await child.waitFor(() => child.exitCode === 0, remaining());
    const timing = { scenario: 'silent-producer', budgetMs: 5000,
      cleanupMs: Math.round(child.observedAt('cleanup-finished')! - startedAt),
      normalExitMs: child.exitedAt === null ? null : Math.round(child.exitedAt - startedAt) };
    expect(exitedNormally && child.exitedAt !== null && child.exitedAt - startedAt <= 5000,
      JSON.stringify({ ...timing, exitCode: child.exitCode, observations: child.observations })).toBe(true);
    console.info('Task 3 outage timing', JSON.stringify(timing));
  } finally {
    try { await harness?.stopAndReap(); }
    finally { await endpoint.close(); }
  }
  const retained = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
  expect(retained.status).toBe('PENDING');
  expect(retained.attempts).toBe(0);
});

test('Redis silent startup SIGTERM cancels the live unready blocking duplicate and exits normally with its due row retained', async () => {
  const row = await dueMail('silent-worker');
  await db.outboxEvent.updateMany({ where: { aggregateId: runId, id: { not: row.id } }, data: { availableAt: new Date(Date.now() + 60_000) } });
  const endpoint = await silentRedisEndpoint();
  let harness: ReturnType<typeof spawnOutage> | undefined;
  try {
    harness = spawnOutage('worker', row.id, endpoint.port);
    const child = harness;
    expect(await child.waitFor(() => child.has('publish-started'), 10_000), JSON.stringify(child.observations)).toBe(true);
    // The caller-owned client, dedicated blocking duplicate and producer must
    // all be TCP-connected and have sent commands to the silent endpoint.
    expect(await endpoint.waitForStartupConnections(3, 10_000)).toBe(true);
    const startedAt = performance.now();
    const remaining = () => Math.max(0, 5000 - (performance.now() - startedAt));
    child.child.send('terminate');
    expect(await child.waitFor(() => child.has('termination-emitted'), Math.min(2000, remaining()))).toBe(true);
    const cleanedUp = await child.waitFor(() => child.has('cleanup-finished'), remaining());
    if (!cleanedUp) {
      child.child.send('inspect-shutdown');
      await child.waitFor(() => child.has('shutdown-status'), 1000);
    }
    expect(cleanedUp, JSON.stringify(child.observations)).toBe(true);
    const cleanup = child.observations.find(message => message.kind === 'cleanup-finished');
    expect((cleanup?.clientsObserved ?? 0) >= 3).toBe(true);
    expect(cleanup?.connectionsEnded).toBe(true);
    const exitedNormally = await child.waitFor(() => child.exitCode === 0, remaining());
    const timing = { scenario: 'silent-SIGTERM', budgetMs: 5000,
      cleanupMs: Math.round(child.observedAt('cleanup-finished')! - startedAt),
      normalExitMs: child.exitedAt === null ? null : Math.round(child.exitedAt - startedAt) };
    expect(exitedNormally && child.exitedAt !== null && child.exitedAt - startedAt <= 5000,
      JSON.stringify({ ...timing, exitCode: child.exitCode, observations: child.observations })).toBe(true);
    console.info('Task 3 outage timing', JSON.stringify(timing));
  } finally {
    try { await harness?.stopAndReap(); }
    finally { await endpoint.close(); }
  }
  const retained = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
  expect(retained.status).toBe('PENDING');
  expect(retained.attempts).toBe(0);
});
