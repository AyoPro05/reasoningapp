import { Queue, Worker, QueueKeys, RedisConnection, RedisQueueBackend, type BackendFactory } from 'bullmq';
import { Redis } from 'ioredis';
import type { DatabaseClient, MailProvider } from '@reasoningapp/database';
import { deliverOutbox, type OutboxBroker, type OutboxJob } from './outbox.js';

export const outboxQueueName = 'reasoningapp-local-outbox';

/** Await the actual end event, not just a request to close the socket. */
function disconnectRedis(connection: Redis): Promise<void> {
  if (connection.status === 'end') return Promise.resolve();
  return new Promise(resolve => {
    const disconnect = () => { connection.disconnect(); };
    connection.once('end', () => {
      connection.removeListener('connecting', disconnect);
      resolve();
    });
    // During backoff the old socket has already emitted close. Disconnecting
    // then clears the retry timer without necessarily emitting end. Interrupt
    // the pending connect transition instead, so ioredis settles its readiness
    // waiters through its actual close/error path (no synthetic status/events).
    if (connection.status === 'reconnecting') connection.once('connecting', disconnect);
    else disconnect();
  });
}

type Producer = { connection: Redis; queue: Queue<OutboxJob>; closing?: Promise<void> };

export function createBullMqBroker(redisUrl: string, queueName = outboxQueueName, signal?: AbortSignal) {
  const producers = new Set<Producer>();
  const publications = new Set<Promise<void>>();
  let closed = false;
  let current: Producer | undefined;
  let closing: Promise<void> | undefined;
  function producer(): Producer {
    if (closed || signal?.aborted) throw new Error('Local outbox publisher closed');
    if (!current || current.closing) {
      // PostgreSQL polling owns retry, not an unbounded producer reconnect loop.
      const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false,
        connectTimeout: 1000, commandTimeout: 1000, retryStrategy: () => null });
      const queue = new Queue<OutboxJob>(queueName, { connection });
      connection.on('error', () => {});
      queue.on('error', () => {});
      current = { connection, queue };
      producers.add(current);
    }
    return current;
  }
  function dispose(resource: Producer): Promise<void> {
    resource.closing ??= (async () => {
      try {
        // Queue.close alone does not close an injected/shared Redis connection.
        await disconnectRedis(resource.connection);
        await resource.queue.close();
      } finally {
        producers.delete(resource);
        if (current === resource) current = undefined;
      }
    })();
    return resource.closing;
  }
  const interrupt = () => {
    closed = true;
    for (const resource of producers) resource.connection.disconnect();
  };
  signal?.addEventListener('abort', interrupt, { once: true });
  const broker: OutboxBroker = { publish(job) {
    const operation = (async () => {
      let resource = producer();
      if (resource.connection.status === 'end') {
        await dispose(resource);
        resource = producer();
      }
      // Actively cancel the underlying connection on deadline; continue awaiting
      // Queue.add and disposal. No abandoned Promise.race or background retry.
      const deadline = setTimeout(() => resource.connection.disconnect(), 2000);
      try {
        await resource.queue.add('deliver', { outboxId: job.outboxId }, {
          jobId: job.outboxId, attempts: 1, removeOnComplete: true, removeOnFail: true,
        });
      } catch {
        await dispose(resource);
        throw new Error('Local outbox publisher unavailable');
      } finally { clearTimeout(deadline); }
    })();
    publications.add(operation);
    void operation.then(() => publications.delete(operation), () => publications.delete(operation));
    return operation;
  } };
  return { ...broker, get queue() { return producer().queue; }, close(): Promise<void> {
    closing ??= (async () => {
      interrupt();
      signal?.removeEventListener('abort', interrupt);
      // Interruption releases readiness/command waits. Join every operation and
      // owned connection before reporting shutdown complete.
      await Promise.allSettled([...publications]);
      const results = await Promise.allSettled([...producers].map(dispose));
      if (results.some(result => result.status === 'rejected')) throw new Error('Local outbox publisher cleanup unavailable');
    })();
    return closing;
  } };
}

export function createBullMqWorker(deps: { db: DatabaseClient; mailProvider: MailProvider; redisUrl: string; queueName?: string; onError?: () => void }) {
  const queueName = deps.queueName ?? outboxQueueName;
  let stopping = false;
  const connection = new Redis(deps.redisUrl, { maxRetriesPerRequest: null, connectTimeout: 1000,
    retryStrategy: attempt => stopping ? null : Math.min(attempt * 50, 250) });
  // Own both raw clients before wrapping them. The default backend's hidden
  // duplicate cannot be interrupted through disconnectBlocking until it is ready.
  const blockingClient = connection.duplicate({ connectionName: `bull:${Buffer.from(queueName).toString('base64')}` });
  connection.on('error', () => { deps.onError?.(); });
  blockingClient.on('error', () => { deps.onError?.(); });
  const mainAdapter = new RedisConnection(connection, { shared: true, blocking: false });
  const blockingAdapter = new RedisConnection(blockingClient, { shared: true, blocking: true });
  // Observe initialization immediately, and join both outcomes during shutdown.
  // Cancellation errors are expected; neither initialization is left pending.
  const initializing = Promise.allSettled([mainAdapter.client, blockingAdapter.client]);
  const backendFactory: BackendFactory<RedisQueueBackend> = (name, options) => {
    // This slice uses BullMQ's default namespace; no custom prefix is exposed.
    const keys = new QueueKeys('bull');
    return new RedisQueueBackend(mainAdapter, name, keys.getKeys(name), key => keys.toKey(name, key), options, blockingAdapter);
  };
  const worker = new Worker<OutboxJob>(queueName, async job => {
    if (job.name !== 'deliver' || typeof job.data?.outboxId !== 'string' || Object.keys(job.data).length !== 1) throw new Error('Invalid outbox job');
    await deliverOutbox(deps, job.data.outboxId);
  }, { connection, concurrency: 4, autorun: false, runRetryDelay: 250 }, backendFactory);
  worker.on('error', () => { deps.onError?.(); });
  worker.on('failed', () => { deps.onError?.(); });
  const running = worker.run().catch(() => { deps.onError?.(); });
  let closing: Promise<void> | undefined;
  return { worker, close(): Promise<void> {
    closing ??= (async () => {
      stopping = true;
      // Mark closing, then cancel BOTH owned raw clients without first awaiting
      // Redis readiness. Shared wrappers leave raw closure to this owner; normal
      // Worker.close still owns its backend metadata/current-job cleanup.
      const stopped = worker.close();
      const results = await Promise.allSettled([
        disconnectRedis(connection), disconnectRedis(blockingClient), initializing, stopped, running,
      ]);
      if (results.some(result => result.status === 'rejected')) throw new Error('Local outbox consumer cleanup unavailable');
    })();
    return closing;
  } };
}
