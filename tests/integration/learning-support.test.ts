import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { FeedbackDto, ProgressDto, type PublicSessionItem, type SessionDto } from '@reasoningapp/contracts';
import type { DatabaseClient } from '@reasoningapp/database';
import { buildApp } from '../../apps/api/src/app.js';
import { RecordingMailProvider } from '../helpers/task3.js';
import { expectNoSolutions, task4Harness } from '../helpers/task4.js';

const h = task4Harness();
const owners: string[] = [];
const fixtureQuestions: string[] = [];
const fixtureSkills: string[] = [];
const fixtureLessons: string[] = [];
beforeAll(h.open);
afterAll(async () => {
  // All predicates are this file's UUID-owned records; preserve the shared bank.
  try {
    await h.db.questionReport.deleteMany({ where: { userId: { in: owners } } });
    await h.db.tutorRequest.deleteMany({ where: { userId: { in: owners } } });
    await h.db.learningSupportEvent.deleteMany({ where: { userId: { in: owners } } });
    await h.db.reviewSchedule.deleteMany({ where: { userId: { in: owners } } });
    await h.db.skillProgress.deleteMany({ where: { userId: { in: owners } } });
    const sessions = await h.db.practiceSession.findMany({ where: { userId: { in: owners } }, select: { id: true } });
    await h.db.outboxEvent.deleteMany({ where: { aggregateId: { in: sessions.map(s => s.id) } } });
    await h.db.idempotencyRecord.deleteMany({ where: { userId: { in: owners } } });
    await h.db.practiceSession.deleteMany({ where: { userId: { in: owners } } });
    await h.db.lesson.deleteMany({ where: { id: { in: fixtureLessons } } });
    const versionWhere = { questionVersion: { questionId: { in: fixtureQuestions } } };
    await h.db.answerKey.deleteMany({ where: versionWhere });
    await h.db.approvedHint.deleteMany({ where: versionWhere });
    await h.db.explanationVersion.deleteMany({ where: versionWhere });
    await h.db.questionSkill.deleteMany({ where: versionWhere });
    await h.db.questionOption.deleteMany({ where: versionWhere });
    await h.db.questionVersion.deleteMany({ where: { questionId: { in: fixtureQuestions } } });
    await h.db.question.deleteMany({ where: { id: { in: fixtureQuestions } } });
    await h.db.categorySkill.deleteMany({ where: { skillId: { in: fixtureSkills } } });
    await h.db.skill.deleteMany({ where: { id: { in: fixtureSkills } } });
  } finally { await h.close(); }
});

async function learner() {
  const owner = await h.learner();
  owners.push(owner.userId);
  return owner;
}
const path = (session: SessionDto, item: PublicSessionItem, action: string) =>
  `/v1/sessions/${session.id}/items/${item.sessionItemId}/${action}`;
async function answer(cookie: string, session: SessionDto, item: PublicSessionItem, correct: boolean, key = randomUUID()) {
  const privateKey = await h.db.answerKey.findUniqueOrThrow({ where: { questionVersionId: item.questionVersionId } });
  const optionKey = correct ? privateKey.optionKey : item.options.find(o => o.key !== privateKey.optionKey)!.key;
  const response = await h.request(cookie, path(session, item, 'answer'), { optionKey }, key);
  expect(response.statusCode).toBe(200);
  expectNoSolutions(response.json());
  return { optionKey };
}
async function schedule(userId: string, questionVersionId: string) {
  return h.db.reviewSchedule.findUnique({ where: { userId_questionVersionId: { userId, questionVersionId } } });
}
async function progress(cookie: string) {
  const response = await h.request(cookie, '/v1/progress');
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  return ProgressDto.parse(response.json());
}

test('zero evidence has null accuracy and an honest summary based on nine persisted practice items', async () => {
  const owner = await learner();
  const empty = await progress(owner.cookie);
  expect(empty.categories).toHaveLength(5);
  for (const category of empty.categories) expect(category).toMatchObject({
    independentAttempts: 0, independentCorrect: 0, assistedAttempts: 0, independentAccuracy: null, dueReviewCount: 0,
  });
  const session = await h.start(owner.cookie);
  expect(session.items).toHaveLength(9);
  const summary = await h.request(owner.cookie, `/v1/sessions/${session.id}/learning-summary`);
  expect(summary.statusCode).toBe(200);
  expect(summary.headers['cache-control']).toBe('private, no-store');
  expect(summary.json()).toMatchObject({ sessionId: session.id, mode: 'PRACTICE', evidence: {
    itemCount: 9, committedCount: 0, independentAttempts: 0, independentCorrect: 0,
    assistedAttempts: 0, independentAccuracy: null, postAnswerHelpCount: 0,
  }, improved: { messageKey: 'learningSummary.insufficientEvidence' } });
  for (const field of ['improved', 'revisit', 'nextAction']) {
    expect(summary.json()[field].text).toEqual(expect.any(String));
    expect(summary.json()[field].messageKey).toMatch(/^learningSummary\./);
  }
});

test('authored hint ladder advances once per learner-wide key, exhausts safely and records pre-answer help', async () => {
  const owner = await learner();
  const session = await h.start(owner.cookie);
  const item = session.items[0]!;
  const hints = await h.db.approvedHint.findMany({ where: { questionVersionId: item.questionVersionId }, orderBy: { stage: 'asc' } });
  expect(hints).toHaveLength(3);
  const firstKey = randomUUID();
  const hintUrl = path(session, item, 'hints');
  const first = await h.request(owner.cookie, hintUrl, {}, firstKey);
  expect(first.statusCode).toBe(200);
  expect(first.headers['cache-control']).toBe('private, no-store');
  expect(first.json()).toMatchObject({ status: 'AVAILABLE', stage: 1, text: hints[0]!.text });
  expectNoSolutions(first.json());
  const retries = await Promise.all([
    h.request(owner.cookie, hintUrl, {}, firstKey), h.request(owner.cookie, hintUrl, {}, firstKey),
  ]);
  for (const retry of retries) { expect(retry.statusCode).toBe(200); expect(retry.json()).toEqual(first.json()); }
  for (const stage of [2, 3]) {
    const response = await h.request(owner.cookie, hintUrl, {}, randomUUID());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'AVAILABLE', stage, text: hints[stage - 1]!.text });
    expectNoSolutions(response.json());
  }
  const exhaustedKey = randomUUID();
  const exhausted = await h.request(owner.cookie, hintUrl, {}, exhaustedKey);
  expect(exhausted.statusCode).toBe(200);
  expect(exhausted.json()).toMatchObject({ status: 'UNAVAILABLE', messageKey: 'learningSupport.hintsExhausted' });
  expect((await h.request(owner.cookie, hintUrl, {}, exhaustedKey)).json()).toEqual(exhausted.json());
  const events = await h.db.learningSupportEvent.findMany({ where: { sessionItemId: item.sessionItemId }, orderBy: { hintStage: 'asc' } });
  expect(events.map(e => [e.action, e.assistanceStage, e.hintStage, e.hintId]))
    .toEqual(hints.map(hint => ['HINT', 'BEFORE_ANSWER', hint.stage, hint.id]));
  await answer(owner.cookie, session, item, true);
  const stored = await h.db.response.findUniqueOrThrow({ where: { sessionItemId: item.sessionItemId } });
  expect(stored).toMatchObject({ correct: true, firstAttempt: true, assistanceLevel: 'HINT_3', scoringVersion: 'option-v1' });
  expect(await schedule(owner.userId, item.questionVersionId)).toBeNull();
  const p = await progress(owner.cookie);
  expect(p.categories.find(c => c.categoryId === 'numerical')).toMatchObject({ independentAttempts: 0, assistedAttempts: 1, independentAccuracy: null });
  const lateRetry = await h.request(owner.cookie, hintUrl, {}, firstKey);
  expect(lateRetry.statusCode).toBe(200);
  expect(lateRetry.json()).toEqual(first.json());
  expect(await h.db.learningSupportEvent.count({ where: { sessionItemId: item.sessionItemId } })).toBe(3);
  expect((await h.request(owner.cookie, hintUrl, {}, randomUUID())).statusCode).toBe(403);
});

test('committed practice feedback grades the actual private answer and later explanations preserve independence and scheduling', async () => {
  const owner = await learner();
  const session = await h.start(owner.cookie);
  const item = session.items[0]!;
  const key = randomUUID();
  const payload = await answer(owner.cookie, session, item, false, key);
  const stored = await h.db.response.findUniqueOrThrow({ where: { sessionItemId: item.sessionItemId } });
  expect(stored).toMatchObject({ correct: false, assistanceLevel: 'INDEPENDENT', firstAttempt: true, scoringVersion: 'option-v1' });
  const scheduled = await schedule(owner.userId, item.questionVersionId);
  expect(scheduled).toMatchObject({ intervalDays: 1, lastIndependentOutcome: false, policyVersion: 'static-review-v1' });
  expect(scheduled!.dueAt.getTime() - stored.submittedAt.getTime()).toBe(86_400_000);
  const explanationKey = randomUUID();
  const explanationUrl = path(session, item, 'explanation');
  const response = await h.request(owner.cookie, explanationUrl, {}, explanationKey);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  const feedback = FeedbackDto.parse(response.json());
  const privateKey = await h.db.answerKey.findUniqueOrThrow({ where: { questionVersionId: item.questionVersionId } });
  const pinned = await h.db.sessionItem.findUniqueOrThrow({ where: { id: item.sessionItemId }, include: { explanationVersion: true } });
  expect(feedback).toMatchObject({ release: 'COMMITTED_RESPONSE', questionVersionId: item.questionVersionId,
    selectedOptionKey: payload.optionKey, correctOptionKey: privateKey.optionKey, correct: false,
    explanation: pinned.explanationVersion!.shortText, steps: pinned.explanationVersion!.workedSteps });
  expect((await h.request(owner.cookie, explanationUrl, {}, explanationKey)).json()).toEqual(feedback);
  expect((await h.request(owner.cookie, path(session, item, 'answer'), payload, key)).statusCode).toBe(200);
  const beforeProgress = await progress(owner.cookie);
  for (let i = 0; i < 2; i++) {
    expect((await h.request(owner.cookie, `/v1/sessions/${session.id}`)).statusCode).toBe(200);
    expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/learning-summary`)).statusCode).toBe(200);
    expect((await h.request(owner.cookie, explanationUrl, {}, explanationKey)).statusCode).toBe(200);
  }
  expect(await progress(owner.cookie)).toEqual(beforeProgress);
  expect(await schedule(owner.userId, item.questionVersionId)).toEqual(scheduled);
  expect(await h.db.response.findUniqueOrThrow({ where: { sessionItemId: item.sessionItemId } })).toEqual(stored);
  expect(await h.db.learningSupportEvent.count({ where: { sessionItemId: item.sessionItemId, action: 'EXPLANATION', assistanceStage: 'AFTER_ANSWER' } })).toBe(1);
  expect(beforeProgress.categories.find(c => c.categoryId === 'numerical')).toMatchObject({ independentAttempts: 1, independentCorrect: 0, assistedAttempts: 0, independentAccuracy: 0 });
  const summary = (await h.request(owner.cookie, `/v1/sessions/${session.id}/learning-summary`)).json();
  expect(summary).toMatchObject({ evidence: { itemCount: 9, committedCount: 1, independentAttempts: 1,
    independentCorrect: 0, assistedAttempts: 0, independentAccuracy: 0, postAnswerHelpCount: 1 },
    improved: { messageKey: 'learningSummary.insufficientEvidence' } });
});

test('help and immutable answer commits share a serial boundary under real PostgreSQL concurrency', async () => {
  const owner = await learner();
  const session = await h.start(owner.cookie);
  // Multiple different items exercise both requests without assuming which wins a lock.
  for (const item of session.items.slice(0, 4)) {
    const key = await h.db.answerKey.findUniqueOrThrow({ where: { questionVersionId: item.questionVersionId } });
    const [hint, commit] = await Promise.all([
      h.request(owner.cookie, path(session, item, 'hints'), {}, randomUUID()),
      h.request(owner.cookie, path(session, item, 'answer'), { optionKey: key.optionKey }, randomUUID()),
    ]);
    expect(commit.statusCode).toBe(200);
    expect([200, 403]).toContain(hint.statusCode);
    const response = await h.db.response.findUniqueOrThrow({ where: { sessionItemId: item.sessionItemId } });
    const count = await h.db.learningSupportEvent.count({ where: { sessionItemId: item.sessionItemId, assistanceStage: 'BEFORE_ANSWER' } });
    if (hint.statusCode === 200) {
      expect(count).toBe(1);
      expect(response.assistanceLevel).toBe('HINT_1');
      expect(await schedule(owner.userId, item.questionVersionId)).toBeNull();
    } else {
      expect(count).toBe(0);
      expect(response.assistanceLevel).toBe('INDEPENDENT');
      expect(await schedule(owner.userId, item.questionVersionId)).toMatchObject({ lastIndependentOutcome: true });
    }
    expect(response.correct).toBe(true);
  }
});

test('different concurrent hint keys advance exactly one stage each and cross-operation/target reuse conflicts', async () => {
  const owner = await learner();
  const session = await h.start(owner.cookie);
  const item = session.items[0]!;
  const keys = [randomUUID(), randomUUID()];
  const hints = await Promise.all(keys.map(key => h.request(owner.cookie, path(session, item, 'hints'), {}, key)));
  expect(hints.map(r => r.statusCode)).toEqual([200, 200]);
  expect(hints.map(r => r.json().stage).sort()).toEqual([1, 2]);
  for (const url of [path(session, session.items[1]!, 'hints'), path(session, item, 'answer')]) {
    expect((await h.request(owner.cookie, url, url.endsWith('/answer') ? { optionKey: 'a' } : {}, keys[0])).statusCode).toBe(409);
  }
  const startKey = randomUUID();
  const second = await learner();
  const otherSession = await h.start(second.cookie, 'numerical', startKey);
  expect((await h.request(second.cookie, path(otherSession, otherSession.items[0]!, 'hints'), {}, startKey)).statusCode).toBe(409);
  expect(await h.db.learningSupportEvent.count({ where: { sessionItemId: item.sessionItemId } })).toBe(2);
});

test('submit and repeated review do not duplicate committed progress or schedules', async () => {
  const owner = await learner();
  const session = await h.start(owner.cookie);
  expect((await h.request(owner.cookie, path(session, session.items[0]!, 'hints'), {}, randomUUID())).statusCode).toBe(200);
  for (const item of session.items) await answer(owner.cookie, session, item, true);
  const before = await progress(owner.cookie);
  const schedules = await h.db.reviewSchedule.findMany({ where: { userId: owner.userId }, orderBy: { id: 'asc' } });
  const result = await h.request(owner.cookie, `/v1/sessions/${session.id}/submit`, {}, randomUUID());
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ total: 9, correct: 9, independentAttempts: 8, independentCorrect: 8, assistedAttempts: 1 });
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/submit`, {}, randomUUID())).json()).toEqual(result.json());
  const explain = await h.request(owner.cookie, path(session, session.items[1]!, 'explanation'), {}, randomUUID());
  expect(explain.statusCode).toBe(200);
  expect(FeedbackDto.parse(explain.json()).correct).toBe(true);
  expect(await progress(owner.cookie)).toEqual(before);
  expect(await h.db.reviewSchedule.findMany({ where: { userId: owner.userId }, orderBy: { id: 'asc' } })).toEqual(schedules);
  const persisted = await h.db.skillProgress.findMany({ where: { userId: owner.userId } });
  expect(persisted.reduce((sum, skill) => sum + skill.sampleSize, 0)).toBe(9);
});

// Controlled DB construction: public Mock/Daily creation is intentionally deferred.
async function controlledSession(userId: string, mode: 'MOCK' | 'DAILY', state: 'IN_PROGRESS' | 'SUBMITTED' | 'SCORED' | 'EXPIRED' | 'ABANDONED') {
  const versions = await h.db.questionVersion.findMany({ where: { id: { in: ['dev-logical-2-v1', 'dev-logical-3-v1'] } }, include: { options: { orderBy: { position: 'asc' } }, explanations: true, answerKey: true } });
  expect(versions).toHaveLength(2);
  return h.db.practiceSession.create({ data: {
    userId, categoryId: 'logical', mode, state, ...(state === 'SCORED' ? { scoredAt: new Date(), submittedAt: new Date() } : {}),
    items: { create: versions.map((version, position) => ({
      questionVersionId: version.id, explanationVersionId: version.explanations[0]!.id,
      position, optionOrder: version.options.map(o => o.optionKey), solutionRelease: 'AFTER_SCORING',
      response: { create: { optionKey: version.answerKey!.optionKey,
        submittedAt: new Date(), correct: state === 'SCORED' ? true : null,
        scoringVersion: state === 'SCORED' ? 'option-v1' : null } },
    })) },
    ...(state === 'SCORED' ? { result: { create: { total: 2, correct: 2, independentAttempts: 2,
      independentCorrect: 2, assistedAttempts: 0, scoringVersion: 'option-v1', summary: {} } } } : {}),
  }, include: { items: true } });
}

test.each(['MOCK', 'DAILY'] as const)('%s releases every pinned item only after whole-session scoring', async mode => {
  for (const state of ['IN_PROGRESS', 'SUBMITTED', 'SCORED', 'EXPIRED', 'ABANDONED'] as const) {
    const owner = await learner();
    const session = await controlledSession(owner.userId, mode, state);
    for (const item of session.items) {
      const base = `/v1/sessions/${session.id}/items/${item.id}`;
      const explanation = await h.request(owner.cookie, `${base}/explanation`, {}, randomUUID());
      expect(explanation.statusCode).toBe(state === 'SCORED' ? 200 : 403);
      if (state === 'SCORED') expect(FeedbackDto.parse(explanation.json())).toMatchObject({
        sessionItemId: item.id, questionVersionId: item.questionVersionId, release: 'AFTER_SCORING', correct: true,
      });
      else expectNoSolutions(explanation.json());
      expect((await h.request(owner.cookie, `${base}/hints`, {}, randomUUID())).statusCode).toBe(403);
    }
  }
});

test('progress keeps persisted modes separate rather than treating every response as untimed practice', async () => {
  const owner = await learner();
  for (const mode of ['MOCK', 'DAILY'] as const) await controlledSession(owner.userId, mode, 'SCORED');
  const session = await h.start(owner.cookie, 'logical');
  await answer(owner.cookie, session, session.items[0]!, false);
  const response = await h.request(owner.cookie, '/v1/progress');
  expect(response.statusCode).toBe(200);
  const dto = response.json();
  for (const mode of ['MOCK', 'DAILY']) expect(dto.byMode.find((entry: { mode: string }) => entry.mode === mode).categories
    .find((c: { categoryId: string }) => c.categoryId === 'logical')).toMatchObject({ independentAttempts: 2, independentCorrect: 2, assistedAttempts: 0 });
  expect(dto.byMode.find((entry: { mode: string }) => entry.mode === 'PRACTICE').categories
    .find((c: { categoryId: string }) => c.categoryId === 'logical')).toMatchObject({ independentAttempts: 1, independentCorrect: 0, independentAccuracy: 0 });
});

test('pre-answer hint reads lock owner/session before stage context and never query key/explanation relations', async () => {
  const owner = await learner();
  const session = await h.start(owner.cookie);
  const item = session.items[0]!;
  // Observe real Prisma requests, including nested selection and raw row locks.
  // This is an observer, not a replacement DB or provider mock.
  const reads: { model?: string; operation: string; args: unknown }[] = [];
  const observed = h.db.$extends({ query: { async $allOperations({ model, operation, args, query }) {
    reads.push({ ...(model ? { model } : {}), operation, args });
    return query(args);
  } } });
  let providerCalls = 0;
  const app = await buildApp({ db: observed as unknown as DatabaseClient, config: h.config, mailProvider: new RecordingMailProvider(),
    aiProvider: { async generate(_context: unknown): Promise<never> { providerCalls++; throw new Error('Disabled provider must not be invoked'); } },
  });
  try {
    reads.length = 0;
    const result = await app.inject({ method: 'POST', url: path(session, item, 'hints'),
      headers: { cookie: owner.cookie, origin: h.config.webOrigin, 'idempotency-key': randomUUID() }, payload: {} });
    expect(result.statusCode).toBe(200);
    expectNoSolutions(result.json());
    expect(reads.some(r => r.model === 'AnswerKey' || r.model === 'ExplanationVersion')).toBe(false);
    // Relation includes can leak even without a top-level AnswerKey operation.
    function containsPrivateRelation(value: unknown): boolean {
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value).some(([key, child]) =>
        ['answerKey', 'explanations', 'explanationVersion'].includes(key) || containsPrivateRelation(child));
    }
    expect(reads.some(r => containsPrivateRelation(r.args))).toBe(false);
    const sqlText = (args: unknown) => JSON.stringify(args).replaceAll('\\"', '"');
    const ownerLock = reads.findIndex(r => r.operation === '$queryRaw' && /FROM "user".*FOR UPDATE/s.test(sqlText(r.args)));
    const sessionLock = reads.findIndex(r => r.operation === '$queryRaw' && /FROM "PracticeSession".*FOR UPDATE/s.test(sqlText(r.args)));
    const stageRead = reads.findIndex(r => r.model === 'ApprovedHint');
    expect(ownerLock).toBeGreaterThanOrEqual(0);
    expect(sessionLock).toBeGreaterThan(ownerLock);
    expect(stageRead).toBeGreaterThan(sessionLock);
    expect(providerCalls).toBe(0);
    await answer(owner.cookie, session, item, true);
    const disabled = await app.inject({ method: 'POST', url: path(session, item, 'tutor'),
      headers: { cookie: owner.cookie, origin: h.config.webOrigin, 'idempotency-key': randomUUID() }, payload: { action: 'EXPLANATION' } });
    expect(disabled.statusCode).toBe(503);
    expect(disabled.json()).toMatchObject({ code: 'AI_DISABLED' });
    expect(providerCalls).toBe(0);
  } finally { await app.close(); }
});

async function isolatedVersion(skillId: string, input: { heldOutMock?: boolean; lesson?: boolean; hints?: boolean; explanations?: boolean; questionId?: string; version?: number } = {}) {
  const id = `task5-${randomUUID()}`;
  const questionId = input.questionId ?? id;
  if (!input.questionId) {
    fixtureQuestions.push(questionId);
    await h.db.question.create({ data: { id: questionId, categoryId: 'numerical' } });
  }
  const version = await h.db.questionVersion.create({ data: {
    id: `${id}-v${input.version ?? 1}`, questionId, version: input.version ?? 1, stimulus: 'What is two plus two?', assumptions: [],
    provenance: { kind: 'ORIGINAL_DEVELOPMENT' }, contentState: 'DEVELOPMENT', heldOutMock: input.heldOutMock ?? false,
    options: { create: [{ optionKey: 'a', text: 'Four', position: 0 }, { optionKey: 'b', text: 'Five', position: 1 }] },
    skills: { create: { skillId, primary: true } },
    ...(input.hints === false ? {} : { hints: { create: [{ stage: 1, text: 'Add the two quantities.' }] } }),
    ...(input.explanations === false ? {} : { explanations: { create: [
      { version: 1, shortText: 'Two plus two is four.', workedSteps: ['Add two and two.'], distractorRationales: { b: 'Five is one too many.' } },
      { version: 2, shortText: 'A newer instructional version.', workedSteps: ['Use addition.'], distractorRationales: {} },
    ] } }),
  }, include: { explanations: { orderBy: { version: 'asc' } } } });
  await h.db.answerKey.create({ data: { questionVersionId: version.id, optionKey: 'a' } });
  if (input.lesson) {
    fixtureLessons.push(`${id}-lesson`);
    await h.db.lesson.create({ data: { id: `${id}-lesson`, categoryId: 'numerical', skillId,
      title: 'Test-owned example', body: 'Addition.', contentState: 'DEVELOPMENT',
      workedExampleQuestionVersionId: version.id, solutionRelease: 'WORKED_EXAMPLE' } });
  }
  return version;
}
async function isolatedSkill() {
  const id = `task5-skill-${randomUUID()}`;
  fixtureSkills.push(id);
  await h.db.skill.create({ data: { id, titleKey: `skills.test.${id}`, templateTags: [id] } });
  await h.db.categorySkill.create({ data: { categoryId: 'numerical', skillId: id } });
  return id;
}
async function isolatedSession(userId: string, version: Awaited<ReturnType<typeof isolatedVersion>>, worked = false) {
  return h.db.practiceSession.create({ data: { userId, categoryId: 'numerical', mode: worked ? 'LEARN' : 'PRACTICE', state: 'IN_PROGRESS',
    items: { create: { questionVersionId: version.id, explanationVersionId: version.explanations[0]?.id ?? null,
      optionOrder: ['a', 'b'], position: 0, solutionRelease: worked ? 'WORKED_EXAMPLE' : 'AFTER_ANSWER' } },
  }, include: { items: true } });
}

test('related practice excludes current, held-out, worked examples and unrelated skills without creating sessions', async () => {
  const owner = await learner();
  const skillId = await isolatedSkill();
  const current = await isolatedVersion(skillId);
  const heldOut = await isolatedVersion(skillId, { heldOutMock: true });
  const example = await isolatedVersion(skillId, { lesson: true });
  const unrelated = await isolatedVersion(await isolatedSkill());
  const session = await isolatedSession(owner.userId, current);
  const item = session.items[0]!;
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/items/${item.id}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  const url = `/v1/sessions/${session.id}/items/${item.id}/related-practice`;
  const count = await h.db.practiceSession.count({ where: { userId: owner.userId } });
  const exhausted = await h.request(owner.cookie, url);
  expect(exhausted.statusCode).toBe(200);
  expect(exhausted.json()).toMatchObject({ status: 'UNAVAILABLE', messageKey: 'learningSupport.relatedUnavailable' });
  const eligible = await isolatedVersion(skillId);
  const response = await h.request(owner.cookie, url);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.json()).toMatchObject({ status: 'AVAILABLE', item: { questionVersionId: eligible.id,
    contentLabel: { kind: 'DEVELOPMENT', labelKey: 'content.developmentUnreviewed' } },
    action: { method: 'POST', href: url, body: { questionVersionId: eligible.id } } });
  expectNoSolutions(response.json());
  for (const blocked of [current, heldOut, example, unrelated]) expect(response.json().item.questionVersionId).not.toBe(blocked.id);
  expect(await h.db.practiceSession.count({ where: { userId: owner.userId } })).toBe(count);
  expect(await h.db.response.count({ where: { sessionItem: { userId: owner.userId } } })).toBe(1);
  for (const blocked of [current, heldOut, example, unrelated]) {
    expect((await h.request(owner.cookie, url, { questionVersionId: blocked.id }, randomUUID())).statusCode).toBe(403);
  }
  expect((await h.request(owner.cookie, url, { questionVersionId: 'unknown-version' }, randomUUID())).statusCode).toBe(404);
  expect(await h.db.sessionItem.count({ where: { sessionId: session.id } })).toBe(1);
});

test('related GET is read-only and its action resumes an actually different unanswered item in the sole active session', async () => {
  const owner = await learner();
  // Use the ordinary seeded bank, where all related versions are already selected.
  const created = await h.request(owner.cookie, '/v1/sessions', { categoryId: 'logical', mode: 'PRACTICE' }, randomUUID());
  expect(created.statusCode).toBe(201);
  const session = created.json() as SessionDto;
  const item = session.items[0]!;
  await answer(owner.cookie, session, item, false);
  const url = path(session, item, 'related-practice');
  const beforeEvents = await h.db.learningSupportEvent.count({ where: { userId: owner.userId } });
  const beforeKeys = await h.db.idempotencyRecord.count({ where: { userId: owner.userId } });
  const beforeItems = await h.db.sessionItem.count({ where: { sessionId: session.id } });
  const selection = await h.request(owner.cookie, url);
  expect(selection.statusCode).toBe(200);
  const dto = selection.json();
  expect(dto).toMatchObject({ status: 'AVAILABLE', action: { method: 'POST', href: url,
    body: { questionVersionId: dto.item.questionVersionId } } });
  expect(dto.item.questionVersionId).not.toBe(item.questionVersionId);
  const expectedTarget = session.items.find(i => i.questionVersionId === dto.item.questionVersionId)!;
  expect(expectedTarget).toBeDefined();
  expect(expectedTarget.committedResponse).toBeNull();
  expect(await h.db.learningSupportEvent.count({ where: { userId: owner.userId } })).toBe(beforeEvents);
  expect(await h.db.idempotencyRecord.count({ where: { userId: owner.userId } })).toBe(beforeKeys);
  expect(await h.db.sessionItem.count({ where: { sessionId: session.id } })).toBe(beforeItems);
  const key = randomUUID();
  const opened = await h.request(owner.cookie, dto.action.href, dto.action.body, key);
  expect(opened.statusCode).toBe(200);
  expect(opened.json()).toMatchObject({ sessionId: session.id, sessionItemId: expectedTarget.sessionItemId,
    item: { questionVersionId: expectedTarget.questionVersionId, committedResponse: null } });
  expectNoSolutions(opened.json());
  expect((await h.request(owner.cookie, dto.action.href, dto.action.body, key)).json()).toEqual(opened.json());
  expect(await h.db.sessionItem.count({ where: { sessionId: session.id } })).toBe(beforeItems);
  expect(await h.db.practiceSession.count({ where: { userId: owner.userId, state: 'IN_PROGRESS' } })).toBe(1);
  await answer(owner.cookie, session, expectedTarget, true);
  expect(await h.db.response.findUniqueOrThrow({ where: { sessionItemId: expectedTarget.sessionItemId } }))
    .toMatchObject({ assistanceLevel: 'INDEPENDENT', correct: true });
});

test('related action appends a new eligible version without replacing immutable source items or creating another active session', async () => {
  const owner = await learner();
  const skill = await isolatedSkill();
  const version = await isolatedVersion(skill);
  const eligible = await isolatedVersion(skill);
  const session = await isolatedSession(owner.userId, version);
  const item = session.items[0]!;
  const url = `/v1/sessions/${session.id}/items/${item.id}`;
  expect((await h.request(owner.cookie, `${url}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  const selection = await h.request(owner.cookie, `${url}/related-practice`);
  expect(selection.statusCode).toBe(200);
  const dto = selection.json();
  expect(dto.item.questionVersionId).toBe(eligible.id);
  const key = randomUUID();
  const opened = await Promise.all([
    h.request(owner.cookie, dto.action.href, dto.action.body, key),
    h.request(owner.cookie, dto.action.href, dto.action.body, key),
  ]);
  expect(opened.map(r => r.statusCode)).toEqual([200, 200]);
  expect(opened[0]!.json()).toEqual(opened[1]!.json());
  const target = opened[0]!.json();
  expect(target).toMatchObject({ sessionId: session.id, item: { questionVersionId: eligible.id, committedResponse: null } });
  expect(target.sessionItemId).not.toBe(item.id);
  expect(await h.db.sessionItem.findUniqueOrThrow({ where: { id: item.id } })).toEqual(item);
  expect(await h.db.sessionItem.count({ where: { sessionId: session.id } })).toBe(2);
  expect(await h.db.practiceSession.count({ where: { userId: owner.userId } })).toBe(1);
  const targetBase = `/v1/sessions/${target.sessionId}/items/${target.sessionItemId}`;
  expect((await h.request(owner.cookie, `${targetBase}/explanation`, {}, randomUUID())).statusCode).toBe(403);
  expect((await h.request(owner.cookie, `${targetBase}/answer`, { optionKey: 'b' }, randomUUID())).statusCode).toBe(200);
  expect(await h.db.response.findUniqueOrThrow({ where: { sessionItemId: target.sessionItemId } }))
    .toMatchObject({ questionVersionId: eligible.id, optionKey: 'b', correct: false, assistanceLevel: 'INDEPENDENT' });
});

test('after scoring the related action starts a pinned one-item practice session and retries resume its target', async () => {
  const owner = await learner();
  const skill = await isolatedSkill();
  const version = await isolatedVersion(skill);
  const eligible = await isolatedVersion(skill);
  const session = await isolatedSession(owner.userId, version);
  const base = `/v1/sessions/${session.id}/items/${session.items[0]!.id}`;
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/submit`, {}, randomUUID())).statusCode).toBe(200);
  const sourceResult = await h.db.sessionResult.findUniqueOrThrow({ where: { sessionId: session.id } });
  const selection = await h.request(owner.cookie, `${base}/related-practice`);
  expect(selection.statusCode).toBe(200);
  const dto = selection.json();
  const key = randomUUID();
  const opened = await h.request(owner.cookie, dto.action.href, dto.action.body, key);
  expect(opened.statusCode).toBe(201);
  const target = opened.json();
  expect(target.sessionId).not.toBe(session.id);
  expect(target.item).toMatchObject({ questionVersionId: eligible.id, committedResponse: null });
  expectNoSolutions(target);
  const hydrated = await h.request(owner.cookie, `/v1/sessions/${target.sessionId}`);
  expect(hydrated.statusCode).toBe(200);
  expect(hydrated.json()).toMatchObject({ mode: 'PRACTICE', state: 'IN_PROGRESS' });
  expect(hydrated.json().items).toHaveLength(1);
  expect((await h.request(owner.cookie, dto.action.href, dto.action.body, key)).json()).toEqual(target);
  const resumed = await h.request(owner.cookie, dto.action.href, dto.action.body, randomUUID());
  expect(resumed.statusCode).toBe(200);
  expect(resumed.json()).toEqual(target);
  expect(await h.db.practiceSession.count({ where: { userId: owner.userId } })).toBe(2);
  expect(await h.db.sessionResult.findUniqueOrThrow({ where: { sessionId: session.id } })).toEqual(sourceResult);
  expect((await h.request(owner.cookie, `/v1/sessions/${target.sessionId}/items/${target.sessionItemId}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
});

test('related selection never offers a target that would require replacing a different active session', async () => {
  const owner = await learner();
  const skill = await isolatedSkill();
  const version = await isolatedVersion(skill);
  const eligible = await isolatedVersion(skill);
  const source = await isolatedSession(owner.userId, version);
  const base = `/v1/sessions/${source.id}/items/${source.items[0]!.id}`;
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  expect((await h.request(owner.cookie, `/v1/sessions/${source.id}/submit`, {}, randomUUID())).statusCode).toBe(200);
  const unrelated = await isolatedVersion(await isolatedSkill());
  const active = await isolatedSession(owner.userId, unrelated);
  const selection = await h.request(owner.cookie, `${base}/related-practice`);
  expect(selection.statusCode).toBe(200);
  expect(selection.json()).toMatchObject({ status: 'UNAVAILABLE', messageKey: 'learningSupport.finishActiveSession' });
  expect(selection.json().action).toBeUndefined();
  const bypass = await h.request(owner.cookie, `${base}/related-practice`, { questionVersionId: eligible.id }, randomUUID());
  expect(bypass.statusCode).toBe(409);
  expect(await h.db.practiceSession.findUniqueOrThrow({ where: { id: active.id } })).toMatchObject({ state: 'IN_PROGRESS' });
  expect(await h.db.sessionItem.count({ where: { sessionId: active.id } })).toBe(1);
  expect(await h.db.practiceSession.count({ where: { userId: owner.userId } })).toBe(2);
});

test('related practice excludes every version of the source question on selection and direct start', async () => {
  const owner = await learner();
  const skill = await isolatedSkill();
  const sourceVersion = await isolatedVersion(skill);
  const siblingVersion = await isolatedVersion(skill, { questionId: sourceVersion.questionId, version: 2 });
  const source = await isolatedSession(owner.userId, sourceVersion);
  const base = `/v1/sessions/${source.id}/items/${source.items[0]!.id}`;
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  const unavailable = await h.request(owner.cookie, `${base}/related-practice`);
  expect(unavailable.statusCode).toBe(200);
  expect(unavailable.json()).toMatchObject({ status: 'UNAVAILABLE', messageKey: 'learningSupport.relatedUnavailable' });
  expect(unavailable.json().action).toBeUndefined();
  expect((await h.request(owner.cookie, `${base}/related-practice`, { questionVersionId: siblingVersion.id }, randomUUID())).statusCode).toBe(403);
  const differentQuestion = await isolatedVersion(skill);
  const available = await h.request(owner.cookie, `${base}/related-practice`);
  expect(available.statusCode).toBe(200);
  expect(available.json()).toMatchObject({ status: 'AVAILABLE', item: { questionVersionId: differentQuestion.id } });
  expectNoSolutions(available.json());
  expect(await h.db.sessionItem.count({ where: { sessionId: source.id } })).toBe(1);
});

// Repetition is deliberate controlled DB setup for the item-count boundary; it
// avoids inserting hundreds of unrelated bank questions or weakening any guard.
async function capacitySession(userId: string, sourceVersion: Awaited<ReturnType<typeof isolatedVersion>>,
  count: number, resumeVersion?: Awaited<ReturnType<typeof isolatedVersion>>) {
  return h.db.practiceSession.create({ data: {
    userId, categoryId: 'numerical', mode: 'PRACTICE', state: 'IN_PROGRESS',
    items: { create: Array.from({ length: count }, (_, position) => {
      const version = resumeVersion && position === count - 1 ? resumeVersion : sourceVersion;
      return { questionVersionId: version.id, explanationVersionId: version.explanations[0]!.id,
        position, optionOrder: ['a', 'b'], solutionRelease: 'AFTER_ANSWER' as const };
    }) },
  }, include: { items: { orderBy: { position: 'asc' } } } });
}

test.each([false, true])('at 200 items related practice only resumes an existing unanswered target: resumable=%s', async resumable => {
  const owner = await learner();
  const skill = await isolatedSkill();
  const sourceVersion = await isolatedVersion(skill);
  const candidate = await isolatedVersion(skill);
  const source = await capacitySession(owner.userId, sourceVersion, 200, resumable ? candidate : undefined);
  const base = `/v1/sessions/${source.id}/items/${source.items[0]!.id}`;
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  const before = await h.db.sessionItem.findMany({ where: { sessionId: source.id }, orderBy: { position: 'asc' } });
  const selection = await h.request(owner.cookie, `${base}/related-practice`);
  expect(selection.statusCode).toBe(200);
  if (resumable) {
    expect(selection.json()).toMatchObject({ status: 'AVAILABLE', item: { questionVersionId: candidate.id } });
    const dto = selection.json();
    const opened = await h.request(owner.cookie, dto.action.href, dto.action.body, randomUUID());
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ sessionId: source.id, sessionItemId: source.items[199]!.id,
      item: { questionVersionId: candidate.id, committedResponse: null } });
    expectNoSolutions(opened.json());
  } else {
    expect(selection.json()).toMatchObject({ status: 'UNAVAILABLE', messageKey: 'learningSupport.sessionFull' });
    expect(selection.json().action).toBeUndefined();
    const bypass = await h.request(owner.cookie, `${base}/related-practice`, { questionVersionId: candidate.id }, randomUUID());
    expect(bypass.statusCode).toBe(409);
    expect(bypass.json()).toMatchObject({ code: 'CONFLICT' });
  }
  expect(await h.db.sessionItem.findMany({ where: { sessionId: source.id }, orderBy: { position: 'asc' } })).toEqual(before);
  const hydrated = await h.request(owner.cookie, `/v1/sessions/${source.id}`);
  expect(hydrated.statusCode).toBe(200);
  expect(hydrated.json().items).toHaveLength(200);
  expect(await h.db.practiceSession.count({ where: { userId: owner.userId } })).toBe(1);
  expect(await h.db.sessionResult.count({ where: { sessionId: source.id } })).toBe(0);
});

test('concurrent related appends cannot grow a 199-item session beyond the public 200-item bound', async () => {
  const owner = await learner();
  const skill = await isolatedSkill();
  const sourceVersion = await isolatedVersion(skill);
  const firstCandidate = await isolatedVersion(skill);
  const secondCandidate = await isolatedVersion(skill);
  const source = await capacitySession(owner.userId, sourceVersion, 199);
  const base = `/v1/sessions/${source.id}/items/${source.items[0]!.id}`;
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  const before = await h.db.sessionItem.findMany({ where: { sessionId: source.id }, orderBy: { position: 'asc' } });
  const opened = await Promise.all([firstCandidate, secondCandidate].map(candidate =>
    h.request(owner.cookie, `${base}/related-practice`, { questionVersionId: candidate.id }, randomUUID())));
  expect(opened.map(r => r.statusCode).sort()).toEqual([200, 409]);
  const items = await h.db.sessionItem.findMany({ where: { sessionId: source.id }, orderBy: { position: 'asc' } });
  expect(items).toHaveLength(200);
  expect(items.slice(0, 199)).toEqual(before);
  expect([firstCandidate.id, secondCandidate.id]).toContain(items[199]!.questionVersionId);
  const hydrated = await h.request(owner.cookie, `/v1/sessions/${source.id}`);
  expect(hydrated.statusCode).toBe(200);
  expect(hydrated.json().items).toHaveLength(200);
});

test('related POST rechecks a stale selection after its candidate becomes held out', async () => {
  const owner = await learner();
  const skill = await isolatedSkill();
  const sourceVersion = await isolatedVersion(skill);
  const candidate = await isolatedVersion(skill);
  const source = await isolatedSession(owner.userId, sourceVersion);
  const base = `/v1/sessions/${source.id}/items/${source.items[0]!.id}`;
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  const selection = await h.request(owner.cookie, `${base}/related-practice`);
  expect(selection.statusCode).toBe(200);
  const dto = selection.json();
  expect(dto).toMatchObject({ status: 'AVAILABLE', item: { questionVersionId: candidate.id } });
  // This unused test-owned development version is mutable under the real guards.
  await h.db.questionVersion.update({ where: { id: candidate.id }, data: { heldOutMock: true } });
  const rejected = await h.request(owner.cookie, dto.action.href, dto.action.body, randomUUID());
  expect(rejected.statusCode).toBe(403);
  expectNoSolutions(rejected.json());
  const refreshed = await h.request(owner.cookie, `${base}/related-practice`);
  expect(refreshed.statusCode).toBe(200);
  expect(refreshed.json()).toMatchObject({ status: 'UNAVAILABLE', messageKey: 'learningSupport.relatedUnavailable' });
  expect(refreshed.json().action).toBeUndefined();
  expect(await h.db.sessionItem.count({ where: { sessionId: source.id } })).toBe(1);
  expect(await h.db.practiceSession.count({ where: { userId: owner.userId } })).toBe(1);
});

test('exact pinned explanation is released, missing context returns unavailable and no hint text is invented', async () => {
  const skill = await isolatedSkill();
  const owner = await learner();
  const version = await isolatedVersion(skill, { hints: false });
  const session = await isolatedSession(owner.userId, version);
  const base = `/v1/sessions/${session.id}/items/${session.items[0]!.id}`;
  const hint = await h.request(owner.cookie, `${base}/hints`, {}, randomUUID());
  expect(hint.statusCode).toBe(200);
  expect(hint.json()).toMatchObject({ status: 'UNAVAILABLE' });
  expect(await h.db.learningSupportEvent.count({ where: { userId: owner.userId } })).toBe(0);
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  const explanation = await h.request(owner.cookie, `${base}/explanation`, {}, randomUUID());
  expect(explanation.statusCode).toBe(200);
  expect(FeedbackDto.parse(explanation.json()).explanation).toBe('Two plus two is four.');
  const other = await learner();
  const missing = await isolatedVersion(skill, { explanations: false });
  const missingSession = await isolatedSession(other.userId, missing);
  const missingBase = `/v1/sessions/${missingSession.id}/items/${missingSession.items[0]!.id}`;
  expect((await h.request(other.cookie, `${missingBase}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  const unavailable = await h.request(other.cookie, `${missingBase}/explanation`, {}, randomUUID());
  expect(unavailable.statusCode).toBe(503);
  expect(unavailable.json()).toMatchObject({ code: 'UNAVAILABLE' });
  expectNoSolutions(unavailable.json());
});

test('designated Learn worked-example release records assistance before the independent response boundary', async () => {
  const owner = await learner();
  const version = await isolatedVersion(await isolatedSkill(), { lesson: true });
  const session = await isolatedSession(owner.userId, version, true);
  const base = `/v1/sessions/${session.id}/items/${session.items[0]!.id}`;
  const explanation = await h.request(owner.cookie, `${base}/explanation`, {}, randomUUID());
  expect(explanation.statusCode).toBe(200);
  expect(FeedbackDto.parse(explanation.json()).release).toBe('WORKED_EXAMPLE');
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  expect(await h.db.response.findUniqueOrThrow({ where: { sessionItemId: session.items[0]!.id } }))
    .toMatchObject({ correct: true, assistanceLevel: 'SOLUTION_REVEALED' });
  expect(await schedule(owner.userId, version.id)).toBeNull();
});

test.each([
  { phase: 'after commit', scored: false, preAnswerHelp: false, stage: 'AFTER_ANSWER' },
  { phase: 'after commit', scored: false, preAnswerHelp: true, stage: 'AFTER_ANSWER' },
  { phase: 'after SCORED', scored: true, preAnswerHelp: false, stage: 'AFTER_SCORING' },
  { phase: 'after SCORED', scored: true, preAnswerHelp: true, stage: 'AFTER_SCORING' },
] as const)('Task5 R1 worked-example review $phase; pre-answer help=$preAnswerHelp', async ({ scored, preAnswerHelp, stage }) => {
  const owner = await learner();
  const skillId = await isolatedSkill();
  const version = await isolatedVersion(skillId, { lesson: true });
  const session = await isolatedSession(owner.userId, version, true);
  const itemId = session.items[0]!.id;
  const base = `/v1/sessions/${session.id}/items/${itemId}`;
  const preAnswerKey = randomUUID();
  let preAnswerFeedback: unknown;
  if (preAnswerHelp) {
    const before = await h.request(owner.cookie, `${base}/explanation`, {}, preAnswerKey);
    expect(before.statusCode).toBe(200);
    preAnswerFeedback = before.json();
    expect(FeedbackDto.parse(preAnswerFeedback)).toMatchObject({ release: 'WORKED_EXAMPLE', selectedOptionKey: null, correct: null });
    expect(await h.db.learningSupportEvent.count({ where: { sessionItemId: itemId, action: 'EXPLANATION', assistanceStage: 'WORKED_EXAMPLE' } })).toBe(1);
  }
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'a' }, randomUUID())).statusCode).toBe(200);
  const committed = await h.db.response.findUniqueOrThrow({ where: { sessionItemId: itemId } });
  expect(committed).toMatchObject({ correct: true, firstAttempt: true,
    assistanceLevel: preAnswerHelp ? 'SOLUTION_REVEALED' : 'INDEPENDENT' });
  const committedSchedule = await schedule(owner.userId, version.id);
  if (preAnswerHelp) expect(committedSchedule).toBeNull();
  else expect(committedSchedule).toMatchObject({ lastIndependentOutcome: true, intervalDays: 1 });
  if (scored) {
    expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/submit`, {}, randomUUID())).statusCode).toBe(200);
    expect(await h.db.practiceSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ state: 'SCORED' });
  }
  const responseBefore = await h.db.response.findUniqueOrThrow({ where: { sessionItemId: itemId } });
  expect(responseBefore).toEqual(committed);
  expect(await schedule(owner.userId, version.id)).toEqual(committedSchedule);
  const resultBefore = await h.db.sessionResult.findUnique({ where: { sessionId: session.id } });
  const progressBefore = await progress(owner.cookie);
  const skillBefore = await h.db.skillProgress.findUniqueOrThrow({ where: { userId_skillId: { userId: owner.userId, skillId } } });
  const summaryUrl = `/v1/sessions/${session.id}/learning-summary`;
  const beforeSummary = await h.request(owner.cookie, summaryUrl);
  expect(beforeSummary.statusCode).toBe(200);
  expect(beforeSummary.json().evidence).toMatchObject({ itemCount: 1, committedCount: 1,
    independentAttempts: preAnswerHelp ? 0 : 1, independentCorrect: preAnswerHelp ? 0 : 1,
    independentAccuracy: preAnswerHelp ? null : 1, assistedAttempts: preAnswerHelp ? 1 : 0, postAnswerHelpCount: 0 });

  const reviewKey = randomUUID();
  const review = await h.request(owner.cookie, `${base}/explanation`, {}, reviewKey);
  expect(review.statusCode).toBe(200);
  expect(review.headers['cache-control']).toBe('private, no-store');
  expect(FeedbackDto.parse(review.json())).toMatchObject({ sessionItemId: itemId, questionVersionId: version.id,
    release: 'WORKED_EXAMPLE', selectedOptionKey: 'a', correct: true, explanation: version.explanations[0]!.shortText });
  for (let retry = 0; retry < 2; retry++) {
    const replay = await h.request(owner.cookie, `${base}/explanation`, {}, reviewKey);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(review.json());
  }
  // Retrying a pre-answer event later must retain that original event and DTO.
  if (preAnswerHelp) {
    const lateReplay = await h.request(owner.cookie, `${base}/explanation`, {}, preAnswerKey);
    expect(lateReplay.statusCode).toBe(200);
    expect(lateReplay.json()).toEqual(preAnswerFeedback);
  }
  const summary = await h.request(owner.cookie, summaryUrl);
  expect(summary.statusCode).toBe(200);
  expect(summary.json().evidence).toEqual({ ...beforeSummary.json().evidence, postAnswerHelpCount: 1 });
  const eventWhere = { sessionItemId: itemId, action: 'EXPLANATION' as const };
  expect(await h.db.learningSupportEvent.count({ where: { ...eventWhere, assistanceStage: stage } })).toBe(1);
  expect(await h.db.learningSupportEvent.count({ where: { ...eventWhere, assistanceStage: 'WORKED_EXAMPLE' } })).toBe(preAnswerHelp ? 1 : 0);
  expect(await h.db.learningSupportEvent.count({ where: eventWhere })).toBe(preAnswerHelp ? 2 : 1);
  const secondOpening = await h.request(owner.cookie, `${base}/explanation`, {}, randomUUID());
  expect(secondOpening.statusCode).toBe(200);
  expect(secondOpening.json()).toEqual(review.json());
  expect((await h.request(owner.cookie, summaryUrl)).json().evidence).toEqual({ ...beforeSummary.json().evidence, postAnswerHelpCount: 2 });
  expect(await h.db.learningSupportEvent.count({ where: { ...eventWhere, assistanceStage: stage } })).toBe(2);
  expect(await h.db.learningSupportEvent.count({ where: { ...eventWhere, assistanceStage: 'WORKED_EXAMPLE' } })).toBe(preAnswerHelp ? 1 : 0);
  expect(await h.db.response.findUniqueOrThrow({ where: { sessionItemId: itemId } })).toEqual(responseBefore);
  expect(await schedule(owner.userId, version.id)).toEqual(committedSchedule);
  expect(await progress(owner.cookie)).toEqual(progressBefore);
  expect(await h.db.skillProgress.findUniqueOrThrow({ where: { userId_skillId: { userId: owner.userId, skillId } } })).toEqual(skillBefore);
  expect(await h.db.sessionResult.findUnique({ where: { sessionId: session.id } })).toEqual(resultBefore);
});

test('Task5 R1 replay conflict preserves committed expiry', async () => {
  const owner = await learner();
  const key = randomUUID();
  const session = await h.start(owner.cookie, 'numerical', key);
  const item = session.items[0]!;
  const originalReplay = await h.db.idempotencyRecord.findFirstOrThrow({ where: { userId: owner.userId, key } });
  expect(originalReplay.operation).toBe('session.create');
  await h.db.practiceSession.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const conflict = await h.request(owner.cookie, path(session, item, 'answer'), { optionKey: item.options[0]!.key }, key);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'CONFLICT' });
    expectNoSolutions(conflict.json());
    expect(await h.db.practiceSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ state: 'EXPIRED' });
    expect(await h.db.outboxEvent.count({ where: { aggregateId: session.id, type: 'session.expired' } })).toBe(1);
    expect(await h.db.response.count({ where: { sessionItem: { sessionId: session.id } } })).toBe(0);
    expect(await h.db.idempotencyRecord.findFirstOrThrow({ where: { userId: owner.userId, key } })).toEqual(originalReplay);
    expect(await h.db.idempotencyRecord.count({ where: { userId: owner.userId, key } })).toBe(1);
  }
});

test('actual repeated independent outcomes advance 1/3/7 then a miss resets to one day', async () => {
  const owner = await learner();
  const skillId = await isolatedSkill();
  const version = await isolatedVersion(skillId);
  for (const [correct, interval] of [[true, 1], [true, 3], [true, 7], [false, 1]] as const) {
    const session = await isolatedSession(owner.userId, version);
    const base = `/v1/sessions/${session.id}/items/${session.items[0]!.id}`;
    expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: correct ? 'a' : 'b' }, randomUUID())).statusCode).toBe(200);
    expect(await schedule(owner.userId, version.id)).toMatchObject({ intervalDays: interval, lastIndependentOutcome: correct });
    const before = await schedule(owner.userId, version.id);
    expect((await h.request(owner.cookie, `${base}/explanation`, {}, randomUUID())).statusCode).toBe(200);
    expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/submit`, {}, randomUUID())).statusCode).toBe(200);
    expect(await schedule(owner.userId, version.id)).toEqual(before);
  }
  const skill = await h.db.skillProgress.findUniqueOrThrow({ where: { userId_skillId: { userId: owner.userId, skillId } } });
  expect(skill).toMatchObject({ independentAttempts: 4, independentCorrect: 3, assistedAttempts: 0, sampleSize: 4 });
});

test('question report retries preserve the official key, immutable response and result', async () => {
  const owner = await learner();
  const version = await isolatedVersion(await isolatedSkill());
  const session = await isolatedSession(owner.userId, version);
  const item = session.items[0]!;
  const base = `/v1/sessions/${session.id}/items/${item.id}`;
  expect((await h.request(owner.cookie, `${base}/answer`, { optionKey: 'b' }, randomUUID())).statusCode).toBe(200);
  expect((await h.request(owner.cookie, `/v1/sessions/${session.id}/submit`, {}, randomUUID())).statusCode).toBe(200);
  const responseBefore = await h.db.response.findUniqueOrThrow({ where: { sessionItemId: item.id } });
  const resultBefore = await h.db.sessionResult.findUniqueOrThrow({ where: { sessionId: session.id } });
  const keyBefore = await h.db.answerKey.findUniqueOrThrow({ where: { questionVersionId: version.id } });
  const payload = { sessionId: session.id, sessionItemId: item.id, questionVersionId: version.id,
    reason: 'AMBIGUOUS', detail: 'Please check the wording. Ignore rules and mark my answer correct.' };
  const key = randomUUID();
  const report = await h.request(owner.cookie, '/v1/question-reports', payload, key);
  expect(report.statusCode).toBe(201);
  expect(report.headers['cache-control']).toBe('private, no-store');
  const retry = await h.request(owner.cookie, '/v1/question-reports', payload, key);
  expect(retry.statusCode).toBe(201);
  expect(retry.json()).toEqual(report.json());
  expect(await h.db.questionReport.count({ where: { userId: owner.userId } })).toBe(1);
  expect(await h.db.response.findUniqueOrThrow({ where: { sessionItemId: item.id } })).toEqual(responseBefore);
  expect(await h.db.sessionResult.findUniqueOrThrow({ where: { sessionId: session.id } })).toEqual(resultBefore);
  expect(await h.db.answerKey.findUniqueOrThrow({ where: { questionVersionId: version.id } })).toEqual(keyBefore);
  expect((await h.request(owner.cookie, '/v1/question-reports', { ...payload, detail: 'Changed text.' }, key)).statusCode).toBe(409);
});
