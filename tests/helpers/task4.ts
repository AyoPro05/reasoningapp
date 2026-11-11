import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SessionDto, type CategoryId } from '@reasoningapp/contracts';
import { seedDevelopment } from '../../packages/database/src/seed.js';
import { buildApp } from '../../apps/api/src/app.js';
import { seedVerifiedDevelopmentUser } from '../../apps/api/src/modules/auth/development-seed.js';
import { cookieHeader, RecordingMailProvider, task3Database } from './task3.js';

/** Real cookie authentication, real entitlement and the guarded Task 3 test DB. */
export function task4Harness() {
  const { db, config: baseConfig } = task3Database();
  const config = { ...baseConfig, developmentFixturesEnabled: true, allowUnreviewedContent: true, seedVerifiedUsers: true };
  const runId = `task4-${randomUUID()}`;
  const userIds: string[] = [];
  const questionIds: string[] = [];
  const versionIds: string[] = [];
  const lessonIds: string[] = [];
  let app: FastifyInstance;
  let connected = false;
  let sequence = 0;
  async function open() {
    await db.$queryRaw`SELECT 1`;
    connected = true;
    await seedDevelopment(db, config);
    app = await buildApp({ db, config, mailProvider: new RecordingMailProvider() });
  }
  function request(cookie: string | undefined, url: string, payload?: object, key?: string) {
    const address = ++sequence;
    return app.inject({
      method: payload === undefined ? 'GET' : 'POST', url,
      remoteAddress: `192.0.${Math.floor(address / 200)}.${address % 200 + 1}`,
      headers: { origin: config.webOrigin, ...(cookie ? { cookie } : {}), ...(key ? { 'idempotency-key': key } : {}) },
      ...(payload === undefined ? {} : { payload }),
    });
  }
  async function learner() {
    const email = `${runId}-${userIds.length}@example.invalid`;
    const password = 'Synthetic-task4-passphrase-642!';
    const { userId } = await seedVerifiedDevelopmentUser(db, config, { email, password, name: 'Task 4 synthetic learner' });
    userIds.push(userId);
    const login = await request(undefined, '/api/auth/sign-in/email', { email, password });
    expect(login.statusCode).toBe(200);
    return { userId, cookie: cookieHeader(login) };
  }
  async function start(cookie: string, categoryId: CategoryId = 'numerical', key = randomUUID()) {
    const response = await request(cookie, '/v1/sessions', { categoryId, mode: 'PRACTICE' }, key);
    expect(response.statusCode).toBe(201);
    return SessionDto.parse(response.json());
  }
  async function lessonFixture(input: { heldOutMock?: boolean; versionState?: 'DEVELOPMENT' | 'DRAFT'; lessonState?: 'DEVELOPMENT' | 'DRAFT' } = {}) {
    const id = `zz-${runId}-${randomUUID()}`;
    const skill = await db.categorySkill.findFirstOrThrow({ where: { categoryId: 'logical' } });
    questionIds.push(id);
    versionIds.push(`${id}-v1`);
    lessonIds.push(`${id}-lesson`);
    await db.question.create({ data: { id, categoryId: 'logical' } });
    await db.questionVersion.create({ data: {
      id: `${id}-v1`, questionId: id, version: 1, stimulus: 'Use only the given premises.',
      assumptions: ['No outside facts may be assumed.'],
      contentState: input.versionState ?? 'DEVELOPMENT', heldOutMock: input.heldOutMock ?? false,
      provenance: { kind: input.versionState === 'DRAFT' ? 'ORIGINAL' : 'ORIGINAL_DEVELOPMENT' },
      options: { create: [{ optionKey: 'a', text: 'Supported', position: 0 }, { optionKey: 'b', text: 'Not supported', position: 1 }] },
      skills: { create: { skillId: skill.skillId, primary: true } },
      explanations: { create: { version: 1, shortText: 'Only the stated premises apply.', workedSteps: ['Read the premises.', 'Compare the conclusion.'], distractorRationales: { b: 'The conclusion follows from the premises.' } } },
    } });
    await db.answerKey.create({ data: { questionVersionId: `${id}-v1`, optionKey: 'a' } });
    await db.lesson.create({ data: {
      id: `${id}-lesson`, categoryId: 'logical', skillId: skill.skillId, title: 'Test-owned example',
      body: 'Compare a conclusion with the premises.', contentState: input.lessonState ?? 'DEVELOPMENT',
      workedExampleQuestionVersionId: `${id}-v1`, solutionRelease: 'WORKED_EXAMPLE',
    } });
    return { lessonId: `${id}-lesson`, questionVersionId: `${id}-v1` };
  }
  async function close() {
    try {
      if (app) await app.close();
      if (!connected) return;
      // Delete only this run's synthetic learners and their aggregates; never reset the bank.
      const sessions = await db.practiceSession.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      await db.outboxEvent.deleteMany({ where: { aggregateId: { in: [...userIds, ...sessions.map(s => s.id)] } } });
      await db.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
      await db.practiceSession.deleteMany({ where: { userId: { in: userIds } } });
      await db.lesson.deleteMany({ where: { id: { in: lessonIds } } });
      await db.answerKey.deleteMany({ where: { questionVersionId: { in: versionIds } } });
      await db.explanationVersion.deleteMany({ where: { questionVersionId: { in: versionIds } } });
      await db.questionSkill.deleteMany({ where: { questionVersionId: { in: versionIds } } });
      await db.questionOption.deleteMany({ where: { questionVersionId: { in: versionIds } } });
      await db.questionVersion.deleteMany({ where: { id: { in: versionIds } } });
      await db.question.deleteMany({ where: { id: { in: questionIds } } });
      await db.entitlement.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    } finally { await db.$disconnect(); }
  }
  return { db, config, open, close, learner, request, start, lessonFixture };
}

/** Detect private solution fields at every nesting depth, not just the root DTO. */
export function expectNoSolutions(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(expectNoSolutions); return; }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    expect(['answerKey', 'correctOptionKey', 'correct', 'explanation', 'explanations', 'workedSteps',
      'distractorRationales', 'authoringNotes', 'provenance', 'scoringVersion', 'password', 'token', 'userId']).not.toContain(key);
    expectNoSolutions(child);
  }
}
