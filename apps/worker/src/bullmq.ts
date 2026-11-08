import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { DatabaseClient, MailProvider } from '@reasoningapp/database';
import { deliverOutbox, type OutboxBroker, type OutboxJob } from './outbox.js';

export const outboxQueueName = 'reasoningapp-local-outbox';

export function createBullMqBroker(redisUrl: string, queueName = outboxQueueName) {
  // Explicit clients work in native ESM. Publisher errors quickly; PostgreSQL
  // retains the row for a later polling pass. Never put tokens/payloads in jobs.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const queue = new Queue<OutboxJob>(queueName, { connection });
  // Consumers report only a fixed code, never raw driver errors/credentials.
  connection.on('error', () => {});
  queue.on('error', () => {});
  const broker: OutboxBroker = { async publish(job) {
    await queue.add('deliver', { outboxId: job.outboxId }, {
      jobId: job.outboxId, attempts: 1, removeOnComplete: true, removeOnFail: true,
    });
  } };
  return { ...broker, queue, async close() { await queue.close(); connection.disconnect(); } };
}

export function createBullMqWorker(deps: { db: DatabaseClient; mailProvider: MailProvider; redisUrl: string; queueName?: string; onError?: () => void }) {
  const connection = new Redis(deps.redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', () => { deps.onError?.(); });
  const worker = new Worker<OutboxJob>(deps.queueName ?? outboxQueueName, async job => {
    if (job.name !== 'deliver' || typeof job.data?.outboxId !== 'string' || Object.keys(job.data).length !== 1) throw new Error('Invalid outbox job');
    await deliverOutbox(deps, job.data.outboxId);
  }, { connection, concurrency: 4 });
  worker.on('error', () => { deps.onError?.(); });
  worker.on('failed', () => { deps.onError?.(); });
  return { worker, async close() { await worker.close(); connection.disconnect(); } };
}
