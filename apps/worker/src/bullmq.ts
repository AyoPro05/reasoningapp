import { Queue, Worker } from 'bullmq';
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
  let stopping = false;
  const connection = new Redis(deps.redisUrl, { maxRetriesPerRequest: null, connectTimeout: 1000,
    // BullMQ's blocking duplicate inherits this closure. Let any already queued
    // bounded reconnect settle to end after shutdown, rather than orphaning its
    // initialisation promise by force-closing the backend first.
    retryStrategy: attempt => stopping ? null : Math.min(attempt * 50, 250) });
  connection.on('error', () => { deps.onError?.(); });
  const worker = new Worker<OutboxJob>(deps.queueName ?? outboxQueueName, async job => {
    if (job.name !== 'deliver' || typeof job.data?.outboxId !== 'string' || Object.keys(job.data).length !== 1) throw new Error('Invalid outbox job');
    await deliverOutbox(deps, job.data.outboxId);
  }, { connection, concurrency: 4, autorun: false, runRetryDelay: 250 });
  worker.on('error', () => { deps.onError?.(); });
  worker.on('failed', () => { deps.onError?.(); });
  const running = worker.run().catch(() => { deps.onError?.(); });
  let closing: Promise<void> | undefined;
  return { worker, close(): Promise<void> {
    closing ??= (async () => {
      stopping = true;
      // Mark closing before releasing readiness. Do not force-close the backend
      // ahead of its initialisation/end events. Its blocking client now stops
      // reconnecting, and normal Worker.close owns blocking/backend cleanup.
      // runRetryDelay bounds a retry sleep entered before closing was observed;
      // Worker.run and current jobs are still joined, never abandoned.
      const stopped = worker.close();
      const results = await Promise.allSettled([
        disconnectRedis(connection), stopped, running,
      ]);
      if (results.some(result => result.status === 'rejected')) throw new Error('Local outbox consumer cleanup unavailable');
    })();
    return closing;
  } };
}
