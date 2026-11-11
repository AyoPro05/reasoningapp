import { createHash } from 'node:crypto';
import type { DatabaseClient, Prisma } from '@reasoningapp/database';
import { AccessError } from '../auth/authorization.js';
import { ProductError } from '../../errors.js';

export const versionInclude = {
  question: true, options: { orderBy: { position: 'asc' } },
  skills: { orderBy: { skillId: 'asc' } }, answerKey: true,
  explanations: { orderBy: { version: 'desc' } },
} satisfies Prisma.QuestionVersionInclude;
export type BankVersion = Prisma.QuestionVersionGetPayload<{ include: typeof versionInclude }>;
export const sessionInclude = {
  items: { orderBy: { position: 'asc' }, include: { questionVersion: { include: versionInclude }, response: true } },
  result: true,
} satisfies Prisma.PracticeSessionInclude;
export type StoredSession = Prisma.PracticeSessionGetPayload<{ include: typeof sessionInclude }>;
export type StoredItem = StoredSession['items'][number];
export type Transaction = Prisma.TransactionClient;
export const activeStates = ['CREATED', 'IN_PROGRESS', 'SUBMITTED'] as const;

/** Shared lock protocol for answer/submit/abandon and future hints: owner, then session.
 * Every writer must use this protocol; the owner row also serialises learner-wide keys
 * and starts across categories. No process-local mutex or external work in the callback.
 */
export function withOwnerTransaction<T>(db: DatabaseClient, userId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "user" WHERE "id" = ${userId} FOR UPDATE`;
    if (!rows.length) throw new AccessError(404, 'NOT_FOUND');
    const now = new Date();
    const entitlement = await tx.entitlement.findFirst({ where: {
      userId, key: 'practice', status: 'ACTIVE', revokedAt: null, startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }, select: { id: true } });
    if (!entitlement) throw new AccessError(403, 'FORBIDDEN');
    return work(tx);
  }, { maxWait: 10_000, timeout: 20_000 });
}

export async function lockSession(tx: Transaction, userId: string, id: string): Promise<StoredSession> {
  await lockSessionRow(tx, userId, id);
  return tx.practiceSession.findUniqueOrThrow({ where: { id }, include: sessionInclude });
}

/** Lock without scoring relations: pre-answer support must use this smaller seam. */
export async function lockSessionRow(tx: Transaction, userId: string, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PracticeSession" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
  if (!rows.length) throw new AccessError(404, 'NOT_FOUND');
}

export type MutationOutcome = { status: number; body: Prisma.InputJsonValue };
export function mutationHash(operation: string, target: object | null, body: object) {
  return createHash('sha256').update(JSON.stringify({ operation, target, body })).digest('hex');
}
/** Only call while holding the learner row lock; uniqueness spans all operations. */
export async function readReplay(tx: Transaction, userId: string, key: string, operation: string, requestHash: string): Promise<MutationOutcome | null> {
  const prior = await tx.idempotencyRecord.findFirst({ where: { userId, key } });
  if (!prior) return null;
  if (prior.operation !== operation || prior.requestHash !== requestHash) throw new ProductError('CONFLICT');
  return { status: prior.responseStatus, body: toJson(prior.responseBody) };
}
export async function saveReplay(tx: Transaction, userId: string, sessionId: string | null, key: string, operation: string, requestHash: string, outcome: MutationOutcome) {
  await tx.idempotencyRecord.create({ data: { userId, sessionId, key, operation, requestHash,
    responseStatus: outcome.status, responseBody: outcome.body, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
}

export async function lockActiveSession(tx: Transaction, userId: string): Promise<StoredSession | null> {
  const active = await tx.practiceSession.findFirst({ where: { userId, state: { in: [...activeStates] } }, select: { id: true } });
  return active ? lockSession(tx, userId, active.id) : null;
}

export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function enqueueSessionEvent(tx: Transaction, sessionId: string, type: string, suffix = sessionId, payload: object = {}) {
  return tx.outboxEvent.create({ data: { aggregateId: sessionId, type, dedupeKey: `${type}:${suffix}`, payload: toJson({ sessionId, ...payload }) } });
}

/** Return instead of throwing on expiry, so the caller can commit it before a 409. */
export async function expireSession(tx: Transaction, session: StoredSession): Promise<StoredSession> {
  if (activeStates.some(state => state === session.state) && session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    const expired = await tx.practiceSession.update({ where: { id: session.id }, data: { state: 'EXPIRED' }, include: sessionInclude });
    await enqueueSessionEvent(tx, session.id, 'session.expired');
    return expired;
  }
  return session;
}
