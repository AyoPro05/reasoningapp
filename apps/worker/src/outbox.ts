import { parseAuthMail, type DatabaseClient, type MailProvider } from '@reasoningapp/database';

export type OutboxJob = { outboxId: string };
export interface OutboxBroker { publish(job: OutboxJob): Promise<void> }
const leaseMilliseconds = 30_000;
const maxAttempts = 5;

/** Publish is repeatable. A failed publish never removes a committed database row.
 * The delivery claim, not an in-memory broker or queue ID, is authoritative. */
export async function publishOutbox(db: DatabaseClient, broker: OutboxBroker, options: { ids?: string[]; limit?: number } = {}): Promise<void> {
  const rows = await db.outboxEvent.findMany({
    where: { type: 'auth.mail', ...(options.ids ? { id: { in: options.ids } } : {}), status: { in: ['PENDING', 'PROCESSING'] }, availableAt: { lte: new Date() } },
    orderBy: [{ availableAt: 'asc' }, { id: 'asc' }], take: options.limit ?? 100, select: { id: true },
  });
  for (const row of rows) await broker.publish({ outboxId: row.id });
}

export async function deliverOutbox(deps: { db: DatabaseClient; mailProvider: MailProvider }, id: string): Promise<void> {
  const { db, mailProvider } = deps;
  if (mailProvider.kind !== 'fake') throw new Error('Only the fake mail provider is available');
  const now = new Date();
  const row = await db.outboxEvent.findUnique({ where: { id } });
  if (!row || !['PENDING', 'PROCESSING'].includes(row.status) || row.availableAt > now) return;
  const claimed = await db.outboxEvent.updateMany({
    where: { id, status: row.status, attempts: row.attempts, availableAt: { lte: now } },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, availableAt: new Date(now.getTime() + leaseMilliseconds) },
  });
  if (!claimed.count) return;
  const attempt = row.attempts + 1;
  // attempts is a fencing generation. An expired old sender cannot alter a new claim.
  const owned = { id, status: 'PROCESSING' as const, attempts: attempt };
  let message;
  try {
    if (row.type !== 'auth.mail') throw new Error('Unsupported event');
    message = parseAuthMail(row.aggregateId, row.payload);
  } catch {
    await db.outboxEvent.updateMany({ where: owned, data: { status: 'DISABLED' } });
    return;
  }
  try {
    const { userId: _userId, ...delivery } = message;
    await mailProvider.send({ ...delivery, deliveryId: id });
    await db.outboxEvent.updateMany({ where: owned, data: { status: 'SUCCEEDED', processedAt: new Date() } });
  } catch {
    // Provider acceptance + lost ack can duplicate with a provider lacking durable
    // idempotency. The stable ID enables dedupe; it is not an exactly-once claim.
    await db.outboxEvent.updateMany({ where: owned, data: {
      status: attempt >= maxAttempts ? 'FAILED' : 'PENDING',
      availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** (attempt - 1))),
    } });
  }
}
