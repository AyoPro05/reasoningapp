import { setTimeout } from 'node:timers/promises';
import { readConfig } from '@reasoningapp/config';
import { createDatabaseClient } from '@reasoningapp/database';
import { assertLocalMail, createFakeMailProvider } from '../../api/src/modules/auth/mail.js';
import { createBullMqBroker, createBullMqWorker } from './bullmq.js';
import { publishOutbox } from './outbox.js';

const config = readConfig(process.env);
const mailProvider = createFakeMailProvider();
assertLocalMail(config, mailProvider);
const db = createDatabaseClient(config.databaseUrl);
const stop = new AbortController();
const broker = createBullMqBroker(config.redisUrl, undefined, stop.signal);
const consumer = createBullMqWorker({ db, mailProvider, redisUrl: config.redisUrl,
  onError: () => { process.stderr.write('Local outbox consumer unavailable.\n'); } });
const terminate = () => { stop.abort(); };
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, terminate);
try {
  while (!stop.signal.aborted) {
    try { await publishOutbox(db, broker); }
    catch { process.stderr.write('Local outbox poll unavailable; committed rows will be retried.\n'); }
    await setTimeout(1000, undefined, { signal: stop.signal }).catch(() => {});
  }
} finally {
  stop.abort();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeListener(signal, terminate);
  const results = await Promise.allSettled([consumer.close(), broker.close()]);
  await db.$disconnect();
  if (results.some(result => result.status === 'rejected')) {
    process.stderr.write('Local outbox cleanup unavailable.\n');
    process.exitCode = 1;
  }
}
