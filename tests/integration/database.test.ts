import { afterAll, beforeAll, expect, test } from 'vitest';
import { loadOptionalTestEnv } from '../helpers/load-test-env.js';
import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../../packages/database/src/client.js';
import { seedDevelopment } from '../../packages/database/src/seed.js';
import { updateQuestionDraft } from '../../packages/database/src/content-writes.js';
import type { Prisma } from '../../packages/database/src/client.js';
import { readConfig } from '../../packages/config/src/index.js';

loadOptionalTestEnv();
const config = readConfig(process.env);
const target = new URL(config.databaseUrl);
if (config.environment !== 'test' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/reasoningapp_integration') {
  throw new Error('Integration tests require the explicitly disposable loopback reasoningapp_integration database.');
}
const db = createDatabaseClient(config.databaseUrl);
const suffix = randomUUID();
const userId = `task2-${suffix}`;
const reviewerId = `task2-reviewer-${suffix}`;
const qid = `task2-question-${suffix}`;
const qvid = `${qid}-v1`;
const sessionId = `task2-session-${suffix}`;
let connected = false;

beforeAll(async () => {
  await seedDevelopment(db, config);
  connected = true;
  await db.user.create({ data: { id: userId, email: `${suffix}@example.invalid`, name: 'Integration learner' } });
  await db.user.create({ data: { id: reviewerId, email: `reviewer-${suffix}@example.invalid`, name: 'Synthetic test reviewer' } });
});
afterAll(async () => {
  try {
    if (!connected) return;
    // Remove only this run's rows, never truncate or reset an unknown database.
    await db.practiceSession.deleteMany({ where: { userId: { in: [userId, reviewerId] } } });
    await db.purchaseTransaction.deleteMany({ where: { userId } });
    await db.providerEvent.deleteMany({ where: { externalEventId: suffix, provider: { in: ['test-one', 'test-two'] } } });
    await db.answerKey.deleteMany({ where: { questionVersionId: qvid } });
    await db.questionOption.deleteMany({ where: { questionVersionId: qvid } });
    await db.questionVersion.deleteMany({ where: { questionId: qid } });
    await db.question.deleteMany({ where: { id: qid } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.user.deleteMany({ where: { id: reviewerId } });
  } finally { await db.$disconnect(); }
});

test('seeds fifty pending fixtures and five worked examples idempotently', async () => {
  await seedDevelopment(db, config);
  expect(await db.questionVersion.count({ where: { contentState: 'DEVELOPMENT' } })).toBe(50);
  expect(await db.lesson.count({ where: { contentState: 'DEVELOPMENT' } })).toBe(5);
  expect(await db.approvedHint.count({ where: { questionVersion: { contentState: 'DEVELOPMENT' }, reviewStatus: 'PENDING' } })).toBe(150);
  const key = await db.answerKey.findUniqueOrThrow({ where: { questionVersionId: 'dev-numerical-1-v1' } });
  expect(key.optionKey).toBe('a');
  await expect(seedDevelopment(db, { ...config, environment: 'production' })).rejects.toThrow();
});

test('maintains Better Auth identity, account, verification and AuthSession fields and relations', async () => {
  const auth = await db.authSession.create({ data: { token: `token-${suffix}`, expiresAt: new Date(Date.now() + 60_000), userId } });
  expect((await db.authSession.findUniqueOrThrow({ where: { token: auth.token }, include: { user: true } })).user.id).toBe(userId);
  await db.account.create({ data: { accountId: userId, providerId: 'credential', userId, password: 'test-only-not-a-real-password' } });
  const verification = await db.verification.create({ data: { identifier: `verify-${suffix}`, value: 'test-only', expiresAt: new Date(Date.now() + 60_000) } });
  expect(verification.identifier).toBe(`verify-${suffix}`);
  await db.verification.delete({ where: { id: verification.id } });
  await expect(db.authSession.create({ data: { token: `missing-${suffix}`, expiresAt: new Date(), userId: 'nonexistent-user' } })).rejects.toThrow();
});

test('binds keys and responses to exact versions and enforces a single active session across concurrent starts', async () => {
  const starts = await Promise.allSettled([0, 1].map(n => db.practiceSession.create({ data: { id: `${sessionId}-${n}`, userId, categoryId: 'numerical', mode: 'PRACTICE', state: 'IN_PROGRESS' } })));
  expect(starts.filter(s => s.status === 'fulfilled')).toHaveLength(1);
  const winner = starts.find(s => s.status === 'fulfilled');
  if (winner?.status !== 'fulfilled') throw new Error('No active session created');
  const item = await db.sessionItem.create({ data: { userId, sessionId: winner.value.id, questionVersionId: 'dev-numerical-1-v1', position: 0, optionOrder: ['a', 'b', 'c'] } });
  await expect(db.sessionItem.create({ data: { userId, sessionId: winner.value.id, questionVersionId: 'dev-numerical-2-v1', position: 0, optionOrder: ['a', 'b', 'c'] } })).rejects.toThrow();
  await expect(db.response.create({ data: { sessionItemId: item.id, questionVersionId: 'dev-numerical-2-v1', optionKey: 'a', submittedAt: new Date() } })).rejects.toThrow();
  await expect(db.response.create({ data: { sessionItemId: item.id, questionVersionId: 'dev-numerical-1-v1', optionKey: 'foreign', submittedAt: new Date() } })).rejects.toThrow();
  await db.response.create({ data: { sessionItemId: item.id, questionVersionId: 'dev-numerical-1-v1', optionKey: 'a', submittedAt: new Date() } });
  await expect(db.response.create({ data: { sessionItemId: item.id, questionVersionId: 'dev-numerical-1-v1', optionKey: 'b', submittedAt: new Date() } })).rejects.toThrow();
  await db.practiceSession.update({ where: { id: winner.value.id }, data: { state: 'SCORED' } });
  await db.practiceSession.create({ data: { id: sessionId, userId, categoryId: 'numerical', mode: 'PRACTICE' } });
  await expect(db.learningSupportEvent.create({ data: { userId: reviewerId, sessionItemId: item.id, questionVersionId: item.questionVersionId, action: 'EXPLANATION', assistanceStage: 'AFTER_ANSWER' } })).rejects.toThrow();
  await expect(db.tutorRequest.create({ data: { userId: reviewerId, sessionItemId: item.id, questionVersionId: item.questionVersionId, action: 'EXPLANATION', assistanceStage: 'AFTER_ANSWER' } })).rejects.toThrow();
});

async function publishSyntheticDraft(tx: Prisma.TransactionClient): Promise<void> {
  // Only an isolated synthetic test draft gets synthetic decisions; fixtures never do.
  const metadata = { reviewerId, reviewedAt: new Date(), publishedAt: new Date(), reviewStatus: 'APPROVED' as const };
  await tx.contentReview.createMany({ data: ['SUBJECT', 'EDITORIAL', 'HINT_DISCLOSURE'].map(stage => ({ questionVersionId: qvid, stage, status: 'APPROVED' as const, reviewerId, reviewedAt: new Date() })) });
  await tx.approvedHint.createMany({ data: [1, 2, 3].map(stage => ({ questionVersionId: qvid, stage, text: `Synthetic stage ${stage}`, ...metadata })) });
  await tx.explanationVersion.create({ data: { questionVersionId: qvid, version: 1, shortText: 'Synthetic test explanation', workedSteps: ['Synthetic test step'], distractorRationales: { b: 'Synthetic test rationale' }, ...metadata } });
  await tx.questionVersion.update({ where: { id: qvid }, data: { contentState: 'PUBLISHED', publishedAt: new Date() } });
}

test('rejects invalid answer-key membership and duplicate immutable version numbers', async () => {
  await db.question.create({ data: { id: qid, categoryId: 'logical', authorId: userId } });
  await db.questionVersion.create({ data: { id: qvid, questionId: qid, version: 1, stimulus: 'Test draft', provenance: { kind: 'ORIGINAL' }, assumptions: ['Test premises only.'] } });
  await expect(db.questionVersion.create({ data: { questionId: qid, version: 1, stimulus: 'Duplicate', provenance: {}, assumptions: [] } })).rejects.toThrow();
  await expect(db.answerKey.create({ data: { questionVersionId: qvid, optionKey: 'missing' } })).rejects.toThrow();
  await db.questionOption.createMany({ data: [{ questionVersionId: qvid, optionKey: 'a', text: 'A', position: 0 }, { questionVersionId: qvid, optionKey: 'b', text: 'B', position: 1 }] });
  await db.answerKey.create({ data: { questionVersionId: qvid, optionKey: 'a' } });
});

test('published question, option, key, hint and explanation remain immutable even through direct writes', async () => {
  const attempts: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = [
    tx => updateQuestionDraft(tx, qvid, { stimulus: 'Changed' }),
    tx => tx.questionVersion.update({ where: { id: qvid }, data: { stimulus: 'Changed' } }),
    tx => tx.questionOption.update({ where: { questionVersionId_optionKey: { questionVersionId: qvid, optionKey: 'b' } }, data: { text: 'Changed' } }),
    tx => tx.answerKey.update({ where: { questionVersionId: qvid }, data: { optionKey: 'b' } }),
    tx => tx.approvedHint.update({ where: { questionVersionId_stage: { questionVersionId: qvid, stage: 1 } }, data: { text: 'Changed' } }),
    tx => tx.explanationVersion.update({ where: { questionVersionId_version: { questionVersionId: qvid, version: 1 } }, data: { shortText: 'Changed' } }),
    tx => tx.question.update({ where: { id: qid }, data: { categoryId: 'verbal' } }),
    tx => tx.questionVersion.delete({ where: { id: qvid } }),
  ];
  for (const attempt of attempts) {
    await expect(db.$transaction(async tx => {
      await publishSyntheticDraft(tx);
      await attempt(tx);
    })).rejects.toThrow(/immutable/);
  }
  // Each transaction rolled back both publication and the attempted mutation.
  expect((await db.questionVersion.findUniqueOrThrow({ where: { id: qvid } })).contentState).toBe('DRAFT');
});

test('rejects fixture self-approval and publication and protects used version trees', async () => {
  await expect(db.questionVersion.update({ where: { id: 'dev-numerical-1-v1' }, data: { contentState: 'PUBLISHED', publishedAt: new Date() } })).rejects.toThrow();
  await expect(db.contentReview.update({ where: { questionVersionId_stage: { questionVersionId: 'dev-numerical-1-v1', stage: 'SUBJECT' } }, data: { status: 'APPROVED', reviewerId: userId, reviewedAt: new Date() } })).rejects.toThrow();
  // Previous test created a response referencing this exact development version.
  await expect(updateQuestionDraft(db, 'dev-numerical-1-v1', { stimulus: 'Changed' })).rejects.toThrow();
  await expect(db.questionOption.update({ where: { questionVersionId_optionKey: { questionVersionId: 'dev-numerical-1-v1', optionKey: 'b' } }, data: { text: 'Changed' } })).rejects.toThrow();
  await expect(db.answerKey.update({ where: { questionVersionId: 'dev-numerical-1-v1' }, data: { optionKey: 'b' } })).rejects.toThrow();
});

test('enforces provider, progress, hint and notification uniqueness and idempotency storage scopes', async () => {
  const event = { provider: 'test-one', externalEventId: suffix, payloadHash: '0'.repeat(64), payload: { synthetic: true } };
  await db.providerEvent.create({ data: event });
  await expect(db.providerEvent.create({ data: event })).rejects.toThrow();
  await db.providerEvent.create({ data: { ...event, provider: 'test-two' } });
  const purchase = { userId, provider: 'test-one', externalTransactionId: suffix, productId: 'synthetic', amountMinor: 0, currency: 'GBP', purchasedAt: new Date() };
  await db.purchaseTransaction.create({ data: purchase });
  await expect(db.purchaseTransaction.create({ data: purchase })).rejects.toThrow();
  const progress = { userId, skillId: 'sequence-properties', policyVersion: 'test-only' };
  await db.skillProgress.create({ data: progress });
  await expect(db.skillProgress.create({ data: progress })).rejects.toThrow();
  const notification = { userId, dedupeKey: `test-${suffix}`, templateKey: 'test.only', parameters: {}, channel: 'fake', scheduledAt: new Date() };
  await db.notification.create({ data: notification });
  await expect(db.notification.create({ data: notification })).rejects.toThrow();
  await expect(db.approvedHint.create({ data: { questionVersionId: 'dev-logical-2-v1', stage: 1, text: 'Duplicate' } })).rejects.toThrow();
  const operation = { userId, sessionId, operation: 'test-answer', key: suffix, requestHash: '0'.repeat(64), responseStatus: 200, responseBody: { committed: true }, expiresAt: new Date(Date.now() + 60_000) };
  await db.idempotencyRecord.create({ data: operation });
  await expect(db.idempotencyRecord.create({ data: operation })).rejects.toThrow();
  await db.idempotencyRecord.create({ data: { ...operation, operation: 'test-submit' } });
});

test('validates pinned option order, user ownership, explanation version and designated example release', async () => {
  const item = { userId, sessionId, questionVersionId: 'dev-numerical-3-v1', position: 2, optionOrder: ['a', 'b', 'c'] };
  await expect(db.sessionItem.create({ data: { ...item, optionOrder: ['a', 'a', 'c'] } })).rejects.toThrow();
  await expect(db.sessionItem.create({ data: { ...item, optionOrder: ['a', 'b', 'foreign'] } })).rejects.toThrow();
  await expect(db.sessionItem.create({ data: { ...item, userId: reviewerId } })).rejects.toThrow();
  const wrongExplanation = await db.explanationVersion.findUniqueOrThrow({ where: { questionVersionId_version: { questionVersionId: 'dev-numerical-2-v1', version: 1 } } });
  await expect(db.sessionItem.create({ data: { ...item, explanationVersionId: wrongExplanation.id } })).rejects.toThrow();
  await expect(db.sessionItem.create({ data: { ...item, questionVersionId: 'dev-numerical-1-v1', solutionRelease: 'WORKED_EXAMPLE' } })).rejects.toThrow();
  const mock = await db.practiceSession.create({ data: { userId: reviewerId, categoryId: 'numerical', mode: 'MOCK' } });
  await expect(db.sessionItem.create({ data: { ...item, userId: reviewerId, sessionId: mock.id } })).rejects.toThrow();
  await db.sessionItem.create({ data: { ...item, userId: reviewerId, sessionId: mock.id, solutionRelease: 'AFTER_SCORING' } });
});
