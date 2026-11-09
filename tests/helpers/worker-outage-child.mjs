// Test-only process isolation: retain real BullMQ/ioredis/DB behaviour while
// observing entry into Queue.add and actual connection cleanup. No broker fake.
import { createRequire } from 'node:module';
import { createHook } from 'node:async_hooks';

// Resolve each actual driver through its declaring workspace, not root hoisting.
const workerRequire = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
const { Queue, Worker } = workerRequire('bullmq');
const { Redis } = workerRequire('ioredis');

const [mode, outboxId] = process.argv.slice(2);
const clients = new Set();
const workers = new Set();
const stages = [];
const timers = new Map();
// Test-only attribution. Raw stacks are inspected locally and never emitted.
const resourceHook = createHook({
  init(id, type, _trigger, resource) {
    if (type !== 'Timeout') return;
    const stack = new Error().stack ?? '';
    const origin = stack.includes('AbstractConnector.disconnect') ? 'redis-disconnect' :
      stack.includes('bullmq') ? 'bullmq' : 'other';
    timers.set(id, { resource, origin });
  },
  destroy(id) { timers.delete(id); },
});
resourceHook.enable();
const send = (kind, details = {}) => {
  if (process.connected) process.send?.({ kind, ...details }, () => {});
};
const originalConnect = Redis.prototype.connect;
Redis.prototype.connect = function (...args) {
  clients.add(this);
  return originalConnect.apply(this, args);
};
const originalAdd = Queue.prototype.add;
Queue.prototype.add = function (...args) {
  const observed = args[1]?.outboxId === outboxId;
  if (observed) send('publish-started');
  const pending = originalAdd.apply(this, args);
  if (observed) void pending.then(
    () => send('publish-settled', { rejected: false }),
    () => send('publish-settled', { rejected: true }),
  );
  return pending;
};
const observe = (pending, stage) => {
  void pending.then(() => { stages.push(`${stage}-fulfilled`); }, () => { stages.push(`${stage}-rejected`); });
  return pending;
};
const originalRun = Worker.prototype.run;
Worker.prototype.run = function (...args) {
  workers.add(this);
  const backend = this.getBackend();
  const originalBackendClose = backend.close;
  backend.close = function (...closeArgs) {
    stages.push('backend-close-entered');
    return observe(originalBackendClose.apply(this, closeArgs), 'backend-close');
  };
  stages.push('worker-run-entered');
  return observe(originalRun.apply(this, args), 'worker-run');
};
const originalWorkerClose = Worker.prototype.close;
Worker.prototype.close = function (...args) {
  stages.push('worker-close-entered');
  return observe(originalWorkerClose.apply(this, args), 'worker-close');
};
process.on('message', message => {
  if (message === 'terminate') {
    // Windows child.kill('SIGTERM') kills immediately instead of exercising the
    // Node handler. Emit inside this isolated process on every platform.
    process.emit('SIGTERM');
    send('termination-emitted');
  }
  if (message === 'inspect-shutdown') {
    send('shutdown-status', {
      stages: [...stages], clientStates: [...clients].map(client => client.status),
      workerStates: [...workers].map(worker => ({ closing: Boolean(worker.closing), closed: Boolean(worker.closed), running: worker.running,
        mainLoop: Boolean(worker.mainLoopRunning), mainConnection: worker.getBackend().connection.status,
        blockingConnection: worker.getBackend().blockingConnection?.status })),
    });
  }
});

async function run() {
  if (mode === 'worker') {
    await import('../../apps/worker/src/index.ts');
    return;
  }
  if (mode !== 'publisher') throw new Error('Invalid outage test mode');
  const { readConfig } = await import('../../packages/config/src/index.ts');
  const { createDatabaseClient } = await import('../../packages/database/src/index.ts');
  const { createBullMqBroker } = await import('../../apps/worker/src/bullmq.ts');
  const { publishOutbox } = await import('../../apps/worker/src/outbox.ts');
  const config = readConfig(process.env);
  const db = createDatabaseClient(config.databaseUrl);
  const broker = createBullMqBroker(config.redisUrl, `task3-outage-${process.pid}`);
  try {
    try { await publishOutbox(db, broker, { ids: [outboxId] }); }
    catch { send('publication-rejected'); }
  } finally {
    await broker.close();
    await db.$disconnect();
  }
}

void run().then(() => {
  send('cleanup-finished', { clientsObserved: clients.size, connectionsEnded: [...clients].every(client => client.status === 'end'),
    activeResources: process.getActiveResourcesInfo(),
    timers: [...timers.values()].filter(({ resource }) => !resource._destroyed).map(({ resource, origin }) => ({
      origin, delayMs: resource._idleTimeout, referenced: resource.hasRef(),
    })),
  });
  resourceHook.disable();
  process.disconnect();
}, () => {
  // Never send/log raw errors: environment, URLs and mail remain private.
  send('harness-failed');
  resourceHook.disable();
  process.exitCode = 1;
  process.disconnect();
});
