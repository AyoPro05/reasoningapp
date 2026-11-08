import { afterAll, beforeAll, expect, test } from 'vitest';
import { enqueueAuthMail } from '../../apps/api/src/modules/auth/mail.js';
import { deliverOutbox, publishOutbox } from '../../apps/worker/src/outbox.js';
import { RecordingMailProvider, task3Database } from '../helpers/task3.js';

const { db, runId } = task3Database();
const mailProvider = new RecordingMailProvider();
let sequence = 0;
let connected = false;
beforeAll(async () => { await db.$queryRaw`SELECT 1`; connected = true; });
afterAll(async () => {
  try { if (connected) await db.outboxEvent.deleteMany({ where: { aggregateId: runId } }); }
  finally { await db.$disconnect(); }
});
function message() {
  return { userId: runId, recipient: `${runId}@example.invalid`, templateKey: 'auth.verifyEmail' as const, url: `http://localhost:3001/api/auth/verify-email?token=synthetic-${runId}-${++sequence}` };
}
async function due(id: string) {
  await db.outboxEvent.update({ where: { id }, data: { availableAt: new Date(0) } });
}

// A nontransactional insert would survive the rollback; duplicate writes would create extra rows.
test('mail writes participate in a caller transaction and deduplicate concurrent identical callbacks', async () => {
  const input = message();
  let rolledBackId = '';
  await expect(db.$transaction(async tx => {
    rolledBackId = (await enqueueAuthMail(tx, input)).id;
    throw new Error('Synthetic rollback');
  })).rejects.toThrow('Synthetic rollback');
  expect(await db.outboxEvent.findUnique({ where: { id: rolledBackId } })).toBeNull();
  const rows = await Promise.all(Array.from({ length: 4 }, () => enqueueAuthMail(db, input)));
  expect(new Set(rows.map(row => row.id)).size).toBe(1);
  expect(await db.outboxEvent.count({ where: { id: rows[0]!.id } })).toBe(1);
});

test('two concurrent workers claim one delivery and persist the succeeded receipt', async () => {
  const row = await enqueueAuthMail(db, message());
  await Promise.all([deliverOutbox({ db, mailProvider }, row.id), deliverOutbox({ db, mailProvider }, row.id)]);
  const stored = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
  expect(stored.status).toBe('SUCCEEDED');
  expect(stored.attempts).toBe(1);
  expect(stored.processedAt).not.toBeNull();
  expect(mailProvider.deliveries.has(row.id)).toBe(true);
  const before = mailProvider.deliveries.size;
  await deliverOutbox({ db, mailProvider }, row.id);
  expect(mailProvider.deliveries.size).toBe(before);
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).attempts).toBe(1);
});

test('transient failure delays retry and retains a stable delivery ID', async () => {
  const row = await enqueueAuthMail(db, message());
  const provider = new RecordingMailProvider();
  provider.failBeforeSend = true;
  await deliverOutbox({ db, mailProvider: provider }, row.id);
  const failed = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
  expect(failed.status).toBe('PENDING');
  expect(failed.availableAt.getTime()).toBeGreaterThan(Date.now());
  expect(provider.deliveries.size).toBe(0);
  provider.failBeforeSend = false;
  await deliverOutbox({ db, mailProvider: provider }, row.id);
  expect(provider.deliveries.size).toBe(0);
  await due(row.id);
  await deliverOutbox({ db, mailProvider: provider }, row.id);
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SUCCEEDED');
  expect(provider.deliveries.get(row.id)?.deliveryId).toBe(row.id);
});

test('provider acceptance followed by lost acknowledgement deduplicates only with the same fake provider state', async () => {
  const row = await enqueueAuthMail(db, message());
  const provider = new RecordingMailProvider();
  provider.failAfterSend = true;
  await deliverOutbox({ db, mailProvider: provider }, row.id);
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
  expect(provider.deliveries.size).toBe(1);
  provider.failAfterSend = false;
  await due(row.id);
  await deliverOutbox({ db, mailProvider: provider }, row.id);
  expect(provider.deliveries.size).toBe(1);
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SUCCEEDED');
});

test('processing leases recover a crashed worker and reject an early competing claim', async () => {
  const row = await enqueueAuthMail(db, message());
  await db.outboxEvent.update({ where: { id: row.id }, data: { status: 'PROCESSING', attempts: 1, availableAt: new Date(Date.now() + 60_000) } });
  await deliverOutbox({ db, mailProvider }, row.id);
  expect(mailProvider.deliveries.has(row.id)).toBe(false);
  await due(row.id);
  await deliverOutbox({ db, mailProvider }, row.id);
  const recovered = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
  expect(recovered.status).toBe('SUCCEEDED');
  expect(recovered.attempts).toBe(2);
});

test('a late expired claimant cannot overwrite a newer successful claim', async () => {
  const row = await enqueueAuthMail(db, message());
  let release!: () => void;
  let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const pause = new Promise<void>(resolve => { release = resolve; });
  const slow = { kind: 'fake' as const, send: async () => { started(); await pause; throw new Error('Synthetic late failure'); } };
  const first = deliverOutbox({ db, mailProvider: slow }, row.id);
  await began;
  await due(row.id);
  await deliverOutbox({ db, mailProvider }, row.id);
  release();
  await first;
  const stored = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
  expect(stored.status).toBe('SUCCEEDED');
  expect(stored.attempts).toBe(2);
});

test('unsupported event types and malformed payloads never reach the mail provider', async () => {
  for (const data of [
    { type: 'billing.charge', payload: { recipient: 'real@example.com' } },
    { type: 'auth.mail', payload: { recipient: 'broken@example.invalid', templateKey: 'auth.verifyEmail' } },
  ]) {
    const row = await db.outboxEvent.create({ data: { ...data, aggregateId: runId, dedupeKey: `${runId}-invalid-${++sequence}` } });
    await deliverOutbox({ db, mailProvider }, row.id);
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('DISABLED');
    expect(mailProvider.deliveries.has(row.id)).toBe(false);
  }
});

test('finite retries retain a failed row for inspection without private exception data', async () => {
  const row = await enqueueAuthMail(db, message());
  const provider = new RecordingMailProvider();
  provider.failBeforeSend = true;
  for (let i = 0; i < 5; i++) { await due(row.id); await deliverOutbox({ db, mailProvider: provider }, row.id); }
  const stored = await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
  expect(stored.status).toBe('FAILED');
  expect(stored.attempts).toBe(5);
  await due(row.id);
  await deliverOutbox({ db, mailProvider: provider }, row.id);
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).attempts).toBe(5);
});

test('broker outages leave committed rows recoverable and jobs contain only outbox IDs', async () => {
  const row = await enqueueAuthMail(db, message());
  await expect(publishOutbox(db, { publish: async () => { throw new Error('Synthetic broker outage'); } }, { ids: [row.id] })).rejects.toThrow('Synthetic broker outage');
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
  const jobs: unknown[] = [];
  await publishOutbox(db, { publish: async job => { jobs.push(job); } }, { ids: [row.id] });
  expect(jobs).toEqual([{ outboxId: row.id }]);
  await deliverOutbox({ db, mailProvider }, row.id);
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SUCCEEDED');
});

test('server mail entry rejects executable URL schemes before persistence', async () => {
  const input = message();
  await expect(enqueueAuthMail(db, { ...input, url: 'javascript:alert(1)' })).rejects.toThrow();
  expect(await db.outboxEvent.count({ where: { aggregateId: runId, payload: { path: ['url'], equals: 'javascript:alert(1)' } } })).toBe(0);
});
