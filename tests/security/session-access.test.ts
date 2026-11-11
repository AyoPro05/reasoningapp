import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { ApiErrorDto } from '@reasoningapp/contracts';
import { expectNoSolutions, task4Harness } from '../helpers/task4.js';

const h = task4Harness();
beforeAll(h.open);
afterAll(h.close);

test('catalog, lessons and all session routes require maintained authenticated learner access', async () => {
  for (const [url, payload] of [
    ['/v1/categories', undefined], ['/v1/lessons/numerical', undefined], ['/v1/sessions/active', undefined],
    ['/v1/sessions/missing', undefined], ['/v1/sessions/missing/results', undefined],
    ['/v1/sessions', { categoryId: 'numerical', mode: 'PRACTICE' }],
    ['/v1/sessions/missing/items/missing/answer', { optionKey: 'a' }],
    ['/v1/sessions/missing/submit', {}], ['/v1/sessions/missing/abandon', {}],
  ] as const) {
    const response = await h.request(undefined, url, payload, randomUUID());
    expect(response.statusCode).toBe(401);
    expect(ApiErrorDto.parse(response.json()).code).toBe('UNAUTHENTICATED');
  }
});

test('revoked entitlement blocks every route including retries, hydration, lessons and results', async () => {
  const owner = await h.learner();
  const key = randomUUID();
  const session = await h.start(owner.cookie, 'numerical', key);
  await h.db.entitlement.updateMany({ where: { userId: owner.userId }, data: { status: 'REVOKED' } });
  for (const [url, payload, operationKey] of [
    ['/v1/categories', undefined, undefined], ['/v1/lessons/numerical', undefined, undefined],
    ['/v1/sessions/active', undefined, undefined], [`/v1/sessions/${session.id}`, undefined, undefined],
    [`/v1/sessions/${session.id}/results`, undefined, undefined],
    ['/v1/sessions', { categoryId: 'numerical', mode: 'PRACTICE' }, key],
    [`/v1/sessions/${session.id}/items/${session.items[0]!.sessionItemId}/answer`, { optionKey: 'a' }, randomUUID()],
    [`/v1/sessions/${session.id}/submit`, {}, randomUUID()], [`/v1/sessions/${session.id}/abandon`, {}, randomUUID()],
  ] as const) {
    const response = await h.request(owner.cookie, url, payload, operationKey);
    expect(response.statusCode).toBe(403);
    expect(ApiErrorDto.parse(response.json()).code).toBe('FORBIDDEN');
  }
});

test('foreign, missing and mixed-session identifiers return uniform safe 404 responses', async () => {
  const owner = await h.learner();
  const other = await h.learner();
  const a = await h.start(owner.cookie);
  const b = await h.start(other.cookie);
  for (const url of [`/v1/sessions/${a.id}`, `/v1/sessions/${a.id}/results`, '/v1/sessions/missing']) {
    const response = await h.request(other.cookie, url);
    expect(response.statusCode).toBe(404);
    expect(ApiErrorDto.parse(response.json()).code).toBe('NOT_FOUND');
  }
  for (const url of [
    `/v1/sessions/${a.id}/items/${a.items[0]!.sessionItemId}/answer`,
    `/v1/sessions/${b.id}/items/${a.items[0]!.sessionItemId}/answer`,
    `/v1/sessions/${b.id}/items/missing/answer`,
  ]) {
    const response = await h.request(other.cookie, url, { optionKey: 'a' }, randomUUID());
    expect(response.statusCode).toBe(404);
    expect(ApiErrorDto.parse(response.json()).code).toBe('NOT_FOUND');
  }
  for (const action of ['submit', 'abandon']) {
    const response = await h.request(other.cookie, `/v1/sessions/${a.id}/${action}`, {}, randomUUID());
    expect(response.statusCode).toBe(404);
  }
  expect(await h.db.response.count({ where: { sessionItem: { sessionId: { in: [a.id, b.id] } } } })).toBe(0);
});

test('strict inputs reject invalid options, client version/reveal/scoring fields and absent idempotency keys', async () => {
  const owner = await h.learner();
  expect((await h.request(owner.cookie, '/v1/sessions', { categoryId: 'numerical', mode: 'PRACTICE' })).statusCode).toBe(400);
  expect((await h.request(owner.cookie, '/v1/sessions', { categoryId: 'other', mode: 'PRACTICE' }, randomUUID())).statusCode).toBe(400);
  for (const mode of ['MOCK', 'DAILY']) expect((await h.request(owner.cookie, '/v1/sessions', { categoryId: 'numerical', mode }, randomUUID())).statusCode).toBe(403);
  const session = await h.start(owner.cookie);
  const item = session.items[0]!;
  const url = `/v1/sessions/${session.id}/items/${item.sessionItemId}/answer`;
  for (const payload of [
    { optionKey: 'not-in-version' }, { optionKey: 'a', questionVersionId: 'foreign-version' },
    { optionKey: 'a', reveal: true }, { optionKey: 'a', correct: true }, { optionKey: 'a', selfReportedReason: '' },
  ]) {
    const response = await h.request(owner.cookie, url, payload, randomUUID());
    expect(response.statusCode).toBe(400);
    expect(ApiErrorDto.parse(response.json()).code).toBe('INVALID_INPUT');
  }
  expect((await h.request(owner.cookie, url, { optionKey: 'a' })).statusCode).toBe(400);
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/submit`, { reveal: true }, randomUUID())).statusCode).toBe(400);
  expect(await h.db.response.count({ where: { sessionItemId: item.sessionItemId } })).toBe(0);
});

test('catalog has five ordered categories and lessons release only their designated worked example', async () => {
  const owner = await h.learner();
  const catalog = await h.request(owner.cookie, '/v1/categories');
  expect(catalog.statusCode).toBe(200);
  expect(catalog.json().categories.map((c: { id: string }) => c.id)).toEqual(['inductive', 'logical', 'numerical', 'verbal', 'mechanical']);
  expectNoSolutions(catalog.json());
  const lesson = await h.request(owner.cookie, '/v1/lessons/numerical');
  expect(lesson.statusCode).toBe(200);
  expect(lesson.json().lessons).toHaveLength(1);
  const example = lesson.json().lessons[0].workedExample;
  expect(example.questionVersionId).toBe('dev-numerical-1-v1');
  expect(example.feedback.release).toBe('WORKED_EXAMPLE');
  expect(example.feedback.correctOptionKey).toBe('a');
  const practice = await h.start(owner.cookie);
  expect(practice.items.some(item => item.questionVersionId === example.questionVersionId)).toBe(false);
  expectNoSolutions(practice);
});

test('lesson release checks designated bank eligibility and held-out status as well as lesson status', async () => {
  const owner = await h.learner();
  const allowed = await h.lessonFixture();
  const heldOut = await h.lessonFixture({ heldOutMock: true });
  const ineligibleVersion = await h.lessonFixture({ versionState: 'DRAFT' });
  const ineligibleLesson = await h.lessonFixture({ lessonState: 'DRAFT' });
  const response = await h.request(owner.cookie, '/v1/lessons/logical');
  expect(response.statusCode).toBe(200);
  const lessons = response.json().lessons as { id: string; workedExample: { questionVersionId: string } }[];
  expect(lessons.map(lesson => lesson.id)).toContain(allowed.lessonId);
  for (const blocked of [heldOut, ineligibleVersion, ineligibleLesson]) {
    expect(lessons.map(lesson => lesson.id)).not.toContain(blocked.lessonId);
    expect(JSON.stringify(response.json())).not.toContain(blocked.questionVersionId);
  }
});

test('practice excludes every designated example, including examples belonging to unavailable lessons', async () => {
  const owner = await h.learner();
  const unavailableExample = await h.lessonFixture({ lessonState: 'DRAFT' });
  const practice = await h.start(owner.cookie, 'logical');
  const lessons = await h.db.lesson.findMany({ where: { categoryId: 'logical' }, select: { workedExampleQuestionVersionId: true } });
  for (const lesson of lessons) expect(practice.items.map(item => item.questionVersionId)).not.toContain(lesson.workedExampleQuestionVersionId);
  expect(practice.items.map(item => item.questionVersionId)).not.toContain(unavailableExample.questionVersionId);
  expect(practice.items).toHaveLength(9);
});
