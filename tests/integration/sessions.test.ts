import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { PublicSessionItem, SessionDto } from '@reasoningapp/contracts';
import { expectNoSolutions, task4Harness } from '../helpers/task4.js';

const h = task4Harness();
beforeAll(h.open);
afterAll(h.close);

test('create and reload preserve exact version and option ordering without private solutions', async () => {
  const owner = await h.learner();
  const session = await h.start(owner.cookie);
  expect(session.state).toBe('IN_PROGRESS');
  expect(session.items).toHaveLength(9);
  expect(session.items.map(item => item.questionVersionId)).not.toContain('dev-numerical-1-v1');
  expectNoSolutions(session);
  for (const item of session.items) {
    expect(item.committedResponse).toBeNull();
    expect(item.contentLabel.kind).toBe('DEVELOPMENT');
    expect(item.stimulus).toContain('Rounding:');
    const persisted = await h.db.sessionItem.findUniqueOrThrow({ where: { id: item.sessionItemId } });
    expect(persisted.questionVersionId).toBe(item.questionVersionId);
    expect(persisted.optionOrder).toEqual(item.options.map(o => o.key));
    expect(persisted.solutionRelease).toBe('AFTER_ANSWER');
  }
  const reload = await h.request(owner.cookie, `/v1/sessions/${session.id}`);
  expect(reload.statusCode).toBe(200);
  expect(SessionDto.parse(reload.json())).toEqual(session);
});

test('committed answers persist and hydrate selections without returning correctness or solutions', async () => {
  const owner = await h.learner();
  const session = await h.start(owner.cookie);
  const item = session.items[0]!;
  const key = randomUUID();
  const payload = { optionKey: item.options[0]!.key, selfReportedReason: 'I compared the quantities.' };
  const url = `/v1/sessions/${session.id}/items/${item.sessionItemId}/answer`;
  const answer = await h.request(owner.cookie, url, payload, key);
  expect(answer.statusCode).toBe(200);
  const committed = PublicSessionItem.parse(answer.json());
  expect(committed.committedResponse?.optionKey).toBe(payload.optionKey);
  expectNoSolutions(answer.json());
  const stored = await h.db.response.findUniqueOrThrow({ where: { sessionItemId: item.sessionItemId } });
  expect(stored.optionKey).toBe(payload.optionKey);
  expect(stored.selfReportedReason).toBe(payload.selfReportedReason);
  expect(stored.questionVersionId).toBe(item.questionVersionId);
  const reload = SessionDto.parse((await h.request(owner.cookie, `/v1/sessions/${session.id}`)).json());
  expect(reload.items[0]).toEqual(committed);
  expectNoSolutions(reload);
  const retry = await h.request(owner.cookie, url, payload, key);
  expect(retry.statusCode).toBe(200);
  expect(retry.json()).toEqual(answer.json());
  expect(await h.db.response.count({ where: { sessionItemId: item.sessionItemId } })).toBe(1);
  expect(await h.db.outboxEvent.count({ where: { aggregateId: session.id, type: 'session.answer-committed' } })).toBe(1);
  expect((await h.request(owner.cookie, url, { optionKey: item.options[1]!.key }, key)).statusCode).toBe(409);
  expect((await h.request(owner.cookie, url, { optionKey: item.options[1]!.key }, randomUUID())).statusCode).toBe(409);
});

test('reject zero-answer and incomplete submissions without inventing a result', async () => {
  const owner = await h.learner();
  const session = await h.start(owner.cookie);
  const submit = () => h.request(owner.cookie, `/v1/sessions/${session.id}/submit`, {}, randomUUID());
  expect((await submit()).statusCode).toBe(409);
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/results`)).statusCode).toBe(409);
  const item = session.items[0]!;
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/items/${item.sessionItemId}/answer`, { optionKey: item.options[0]!.key }, randomUUID())).statusCode).toBe(200);
  expect((await submit()).statusCode).toBe(409);
  expect(await h.db.sessionResult.count({ where: { sessionId: session.id } })).toBe(0);
  expect((await h.db.practiceSession.findUniqueOrThrow({ where: { id: session.id } })).state).toBe('IN_PROGRESS');
});

test('submit scores private pinned keys once, persists result and outbox, and prevents late changes', async () => {
  const owner = await h.learner();
  const session = await h.start(owner.cookie);
  for (const [i, item] of session.items.entries()) {
    // Test oracle reads the real private bank; only the first answer is correct.
    const answerKey = await h.db.answerKey.findUniqueOrThrow({ where: { questionVersionId: item.questionVersionId } });
    const optionKey = i === 0 ? answerKey.optionKey : item.options.find(o => o.key !== answerKey.optionKey)!.key;
    expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/items/${item.sessionItemId}/answer`, { optionKey }, randomUUID())).statusCode).toBe(200);
  }
  const url = `/v1/sessions/${session.id}/submit`;
  const key = randomUUID();
  const submitted = await h.request(owner.cookie, url, {}, key);
  expect(submitted.statusCode).toBe(200);
  expect(submitted.json()).toMatchObject({ sessionId: session.id, total: session.items.length, correct: 1, independentAttempts: session.items.length, independentCorrect: 1, assistedAttempts: 0 });
  const retry = await h.request(owner.cookie, url, {}, key);
  expect(retry.statusCode).toBe(200);
  expect(retry.json()).toEqual(submitted.json());
  const result = await h.request(owner.cookie, `/v1/sessions/${session.id}/results`);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toEqual(submitted.json());
  expect(await h.db.sessionResult.count({ where: { sessionId: session.id } })).toBe(1);
  expect(await h.db.outboxEvent.count({ where: { aggregateId: session.id, type: 'session.scored' } })).toBe(1);
  const item = session.items[0]!;
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/items/${item.sessionItemId}/answer`, { optionKey: item.options[1]!.key }, randomUUID())).statusCode).toBe(409);
  expect((await h.db.practiceSession.findUniqueOrThrow({ where: { id: session.id } })).state).toBe('SCORED');
});

test('start retries replay the original outcome and reject changed bodies or operations using the same key', async () => {
  const owner = await h.learner();
  const key = randomUUID();
  const payload = { categoryId: 'logical', mode: 'PRACTICE' };
  const initial = await h.request(owner.cookie, '/v1/sessions', payload, key);
  expect(initial.statusCode).toBe(201);
  const retry = await h.request(owner.cookie, '/v1/sessions', payload, key);
  expect(retry.statusCode).toBe(201);
  expect(retry.json()).toEqual(initial.json());
  expect((await h.request(owner.cookie, '/v1/sessions', { ...payload, categoryId: 'verbal' }, key)).statusCode).toBe(409);
  const session = SessionDto.parse(initial.json());
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/abandon`, {}, key)).statusCode).toBe(409);
  expect(await h.db.practiceSession.count({ where: { userId: owner.userId } })).toBe(1);
});

test('active hydration and idempotent abandonment allow another category without losing history', async () => {
  const owner = await h.learner();
  expect((await h.request(owner.cookie, '/v1/sessions/active')).json()).toEqual({ session: null });
  const session = await h.start(owner.cookie);
  const active = await h.request(owner.cookie, '/v1/sessions/active');
  expect(active.statusCode).toBe(200);
  expect(active.json()).toEqual({ session });
  expect((await h.request(owner.cookie, '/v1/sessions', { categoryId: 'verbal', mode: 'PRACTICE' }, randomUUID())).statusCode).toBe(409);
  const key = randomUUID();
  const url = `/v1/sessions/${session.id}/abandon`;
  const abandoned = await h.request(owner.cookie, url, {}, key);
  expect(abandoned.statusCode).toBe(200);
  expect(SessionDto.parse(abandoned.json()).state).toBe('ABANDONED');
  expect((await h.request(owner.cookie, url, {}, key)).json()).toEqual(abandoned.json());
  expect((await h.request(owner.cookie, '/v1/sessions/active')).json()).toEqual({ session: null });
  expect((await h.start(owner.cookie, 'verbal')).categoryId).toBe('verbal');
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/submit`, {}, randomUUID())).statusCode).toBe(409);
});

test('concurrent starts enforce one active session with safe conflicts and exact-key replay', async () => {
  const owner = await h.learner();
  const key = randomUUID();
  const payload = { categoryId: 'logical', mode: 'PRACTICE' };
  const same = await Promise.all([h.request(owner.cookie, '/v1/sessions', payload, key), h.request(owner.cookie, '/v1/sessions', payload, key)]);
  expect(same.map(r => r.statusCode)).toEqual([201, 201]);
  expect(same[0]!.json()).toEqual(same[1]!.json());
  const other = await h.learner();
  const different = await Promise.all([h.request(other.cookie, '/v1/sessions', payload, randomUUID()), h.request(other.cookie, '/v1/sessions', payload, randomUUID())]);
  expect(different.map(r => r.statusCode).sort()).toEqual([201, 409]);
  expect(await h.db.practiceSession.count({ where: { userId: other.userId } })).toBe(1);
});

test('answer versus submit and duplicate submissions cannot produce partial or duplicate results', async () => {
  const owner = await h.learner();
  const session = await h.start(owner.cookie);
  for (const item of session.items.slice(0, -1)) {
    expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/items/${item.sessionItemId}/answer`, { optionKey: item.options[0]!.key }, randomUUID())).statusCode).toBe(200);
  }
  const last = session.items.at(-1)!;
  const submitUrl = `/v1/sessions/${session.id}/submit`;
  const [answer, submit] = await Promise.all([
    h.request(owner.cookie, `/v1/sessions/${session.id}/items/${last.sessionItemId}/answer`, { optionKey: last.options[0]!.key }, randomUUID()),
    h.request(owner.cookie, submitUrl, {}, randomUUID()),
  ]);
  expect(answer.statusCode).toBe(200);
  expect([200, 409]).toContain(submit.statusCode);
  const duplicates = await Promise.all([h.request(owner.cookie, submitUrl, {}, randomUUID()), h.request(owner.cookie, submitUrl, {}, randomUUID())]);
  expect(duplicates.map(r => r.statusCode)).toEqual([200, 200]);
  expect(duplicates[0]!.json()).toEqual(duplicates[1]!.json());
  expect(await h.db.sessionResult.count({ where: { sessionId: session.id } })).toBe(1);
  expect(await h.db.outboxEvent.count({ where: { aggregateId: session.id, type: 'session.scored' } })).toBe(1);
  expect(await h.db.response.count({ where: { sessionItem: { sessionId: session.id } } })).toBe(session.items.length);
});

test('answer and idempotency persistence roll back together when the outbox insert fails', async () => {
  const owner = await h.learner();
  const session = await h.start(owner.cookie);
  const item = session.items[0]!;
  const key = randomUUID();
  // A test-owned unique-key collision forces a real PostgreSQL write failure.
  const blocker = await h.db.outboxEvent.create({ data: {
    type: 'task4.forced-conflict', aggregateId: session.id,
    dedupeKey: `session.answer-committed:${item.sessionItemId}`, payload: {},
  } });
  const url = `/v1/sessions/${session.id}/items/${item.sessionItemId}/answer`;
  const payload = { optionKey: item.options[0]!.key };
  const failed = await h.request(owner.cookie, url, payload, key);
  expect(failed.statusCode).toBe(500);
  expect(await h.db.response.count({ where: { sessionItemId: item.sessionItemId } })).toBe(0);
  expect(await h.db.idempotencyRecord.count({ where: { userId: owner.userId, key } })).toBe(0);
  await h.db.outboxEvent.delete({ where: { id: blocker.id } });
  expect((await h.request(owner.cookie, url, payload, key)).statusCode).toBe(200);
  expect(await h.db.response.count({ where: { sessionItemId: item.sessionItemId } })).toBe(1);
  expect(await h.db.outboxEvent.count({ where: { aggregateId: session.id, type: 'session.answer-committed' } })).toBe(1);
});

test('submission rolls back result, session state, scoring and replay record when outbox insertion fails', async () => {
  const owner = await h.learner();
  const session = await h.start(owner.cookie);
  for (const item of session.items) {
    expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/items/${item.sessionItemId}/answer`, { optionKey: item.options[0]!.key }, randomUUID())).statusCode).toBe(200);
  }
  const before = await h.db.response.findMany({ where: { sessionItem: { sessionId: session.id } }, orderBy: { sessionItemId: 'asc' } });
  const blocker = await h.db.outboxEvent.create({ data: {
    type: 'task4.forced-conflict', aggregateId: session.id,
    dedupeKey: `session.scored:${session.id}`, payload: {},
  } });
  const key = randomUUID();
  const url = `/v1/sessions/${session.id}/submit`;
  expect((await h.request(owner.cookie, url, {}, key)).statusCode).toBe(500);
  expect(await h.db.sessionResult.count({ where: { sessionId: session.id } })).toBe(0);
  expect((await h.db.practiceSession.findUniqueOrThrow({ where: { id: session.id } })).state).toBe('IN_PROGRESS');
  expect(await h.db.idempotencyRecord.count({ where: { userId: owner.userId, key } })).toBe(0);
  expect(await h.db.response.findMany({ where: { sessionItem: { sessionId: session.id } }, orderBy: { sessionItemId: 'asc' } })).toEqual(before);
  await h.db.outboxEvent.delete({ where: { id: blocker.id } });
  expect((await h.request(owner.cookie, url, {}, key)).statusCode).toBe(200);
  expect(await h.db.sessionResult.count({ where: { sessionId: session.id } })).toBe(1);
  expect(await h.db.outboxEvent.count({ where: { aggregateId: session.id, type: 'session.scored' } })).toBe(1);
});

test('server deadline persists expiration, releases the active slot and never fabricates results', async () => {
  const owner = await h.learner();
  const session = await h.start(owner.cookie);
  await h.db.practiceSession.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
  const item = session.items[0]!;
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/items/${item.sessionItemId}/answer`, { optionKey: item.options[0]!.key }, randomUUID())).statusCode).toBe(409);
  expect((await h.db.practiceSession.findUniqueOrThrow({ where: { id: session.id } })).state).toBe('EXPIRED');
  expect((await h.request(owner.cookie, '/v1/sessions/active')).json()).toEqual({ session: null });
  expect(await h.db.sessionResult.count({ where: { sessionId: session.id } })).toBe(0);
  await h.start(owner.cookie, 'mechanical');
});
