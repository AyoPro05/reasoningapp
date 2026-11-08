import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { enqueueAuthMail } from '../../apps/api/src/modules/auth/mail.js';
import { createBullMqBroker, createBullMqWorker } from '../../apps/worker/src/bullmq.js';
import { publishOutbox } from '../../apps/worker/src/outbox.js';
import { RecordingMailProvider, task3Database } from '../helpers/task3.js';

// Explicit opt-in only. CI enables it and supplies a real Redis service.
test.skipIf(process.env.RUN_REDIS_INTEGRATION !== 'true')('real BullMQ retains a job across producer restart and delivers retryable committed mail', async () => {
  const redisUrl = process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:6379/15';
  const redisTarget = new URL(redisUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(redisTarget.hostname) || redisTarget.port !== '6379' || redisTarget.pathname !== '/15') {
    throw new Error('Real queue tests require explicit loopback:6379/15 Redis');
  }
  const { db, runId } = task3Database();
  const queueName = `task3-${randomUUID()}`;
  const provider = new RecordingMailProvider();
  let broker = createBullMqBroker(redisUrl, queueName);
  let consumer: ReturnType<typeof createBullMqWorker> | undefined;
  try {
    await broker.queue.waitUntilReady();
    const row = await enqueueAuthMail(db, { userId: runId, recipient: `${runId}@example.invalid`, templateKey: 'auth.welcome' });
    await publishOutbox(db, broker, { ids: [row.id] });
    await broker.close();
    broker = createBullMqBroker(redisUrl, queueName);
    await broker.queue.waitUntilReady();
    const retained = await broker.queue.getJob(row.id);
    expect(retained?.data).toEqual({ outboxId: row.id });
    expect(await retained?.getState()).toBe('waiting');
    provider.failBeforeSend = true;
    consumer = createBullMqWorker({ db, mailProvider: provider, redisUrl, queueName });
    await consumer.worker.waitUntilReady();
    async function waitFor(predicate: () => Promise<boolean>) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await setTimeout(25);
      }
      throw new Error('Real queue condition timed out');
    }
    await waitFor(async () => {
      const value = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
      return value.status === 'PENDING' && value.attempts === 1;
    });
    // Wait for BullMQ's completion/removal before reusing the stable job ID.
    await waitFor(async () => !await broker.queue.getJob(row.id));
    provider.failBeforeSend = false;
    await db.outboxEvent.update({ where: { id: row.id }, data: { availableAt: new Date(0) } });
    await publishOutbox(db, broker, { ids: [row.id] });
    await waitFor(async () => (await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).status === 'SUCCEEDED');
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).attempts).toBe(2);
    expect(provider.deliveries.size).toBe(1);
    expect(provider.deliveries.has(row.id)).toBe(true);
  } finally {
    await consumer?.close();
    // Only the uniquely named queue created by this test is removed. No FLUSHDB.
    await broker.queue.obliterate({ force: true });
    await broker.close();
    await db.outboxEvent.deleteMany({ where: { aggregateId: runId } });
    await db.$disconnect();
  }
});
