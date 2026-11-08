import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadOptionalTestEnv } from '../helpers/load-test-env.js';
import { readConfig } from '../../packages/config/src/index.js';
import { createDatabaseClient } from '../../packages/database/src/client.js';
import type { Prisma } from '../../packages/database/src/client.js';
import { seedDevelopment } from '../../packages/database/src/seed.js';

loadOptionalTestEnv();
const config = readConfig(process.env);
const target = new URL(config.databaseUrl);
if (config.environment !== 'test' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/reasoningapp_integration') {
  throw new Error('Integration tests require the explicitly disposable loopback reasoningapp_integration database.');
}
const db = createDatabaseClient(config.databaseUrl);

beforeAll(async () => { await seedDevelopment(db, config); });
afterAll(async () => { await db.$disconnect(); });

/** The intended rejection rolls back all setup rows. If a buggy schema accepts
 * the write, the sentinel forces rollback and fails the specific error assertion.
 * Neither RED nor GREEN can leave an active session or synthetic content behind.
 */
function rejectedWrite(action: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<never> {
  return db.$transaction(async tx => {
    await action(tx);
    throw new Error('Regression write unexpectedly succeeded');
  });
}

async function sessionWithItem(tx: Prisma.TransactionClient, mode: 'LEARN' | 'PRACTICE') {
  const suffix = randomUUID();
  const user = await tx.user.create({ data: { id: `task2-regression-${suffix}`, email: `${suffix}@example.invalid`, name: 'Synthetic regression learner' } });
  const session = await tx.practiceSession.create({ data: { userId: user.id, categoryId: 'numerical', mode } });
  // This is a designated lesson example; WORKED_EXAMPLE is valid only in Learn.
  const item = await tx.sessionItem.create({ data: {
    userId: user.id, sessionId: session.id, questionVersionId: 'dev-numerical-1-v1', position: 0,
    optionOrder: ['a', 'b', 'c'], solutionRelease: mode === 'LEARN' ? 'WORKED_EXAMPLE' : 'AFTER_ANSWER',
  } });
  expect(item.optionOrder).toEqual(['a', 'b', 'c']);
  return { user, session, item };
}

test.each(['omitted', 'NULL'] as const)('rejects raw SessionItem insert with %s optionOrder', async kind => {
  await expect(rejectedWrite(async tx => {
    const { user, session } = await sessionWithItem(tx, 'PRACTICE');
    const id = randomUUID();
    if (kind === 'omitted') {
      await tx.$executeRaw`
        INSERT INTO "SessionItem" ("id", "userId", "sessionId", "questionVersionId", "position")
        VALUES (${id}, ${user.id}, ${session.id}, 'dev-numerical-1-v1', 1)
      `;
    } else {
      await tx.$executeRaw`
        INSERT INTO "SessionItem" ("id", "userId", "sessionId", "questionVersionId", "position", "optionOrder")
        VALUES (${id}, ${user.id}, ${session.id}, 'dev-numerical-1-v1', 1, NULL)
      `;
    }
  })).rejects.toThrow(/null value in column "optionOrder"[\s\S]*not-null constraint/i);
});

async function draftWithExplanation(tx: Prisma.TransactionClient): Promise<string> {
  const suffix = randomUUID();
  const question = await tx.question.create({ data: { id: `task2-regression-question-${suffix}`, categoryId: 'numerical' } });
  const version = await tx.questionVersion.create({ data: {
    id: `task2-regression-version-${suffix}`, questionId: question.id, version: 1,
    stimulus: 'Synthetic regression draft, never published.', provenance: { kind: 'ORIGINAL' }, assumptions: ['Synthetic premises only.'],
  } });
  const explanation = await tx.explanationVersion.create({ data: {
    questionVersionId: version.id, version: 1, shortText: 'Synthetic positive control.',
    workedSteps: ['Synthetic worked step.'], distractorRationales: {},
  } });
  expect(explanation.workedSteps).toEqual(['Synthetic worked step.']);
  return version.id;
}

test.each(['omitted', 'NULL'] as const)('rejects raw ExplanationVersion insert with %s workedSteps', async kind => {
  await expect(rejectedWrite(async tx => {
    const questionVersionId = await draftWithExplanation(tx);
    const id = randomUUID();
    if (kind === 'omitted') {
      await tx.$executeRaw`
        INSERT INTO "ExplanationVersion" ("id", "questionVersionId", "version", "shortText", "distractorRationales")
        VALUES (${id}, ${questionVersionId}, 2, 'Synthetic missing steps.', '{}'::jsonb)
      `;
    } else {
      await tx.$executeRaw`
        INSERT INTO "ExplanationVersion" ("id", "questionVersionId", "version", "shortText", "distractorRationales", "workedSteps")
        VALUES (${id}, ${questionVersionId}, 2, 'Synthetic missing steps.', '{}'::jsonb, NULL)
      `;
    }
  })).rejects.toThrow(/null value in column "workedSteps"[\s\S]*not-null constraint/i);
});

test('continues to reject an empty optionOrder rather than replacing missing data with an empty array', async () => {
  await expect(rejectedWrite(async tx => {
    const { user, session } = await sessionWithItem(tx, 'PRACTICE');
    await tx.$executeRaw`
      INSERT INTO "SessionItem" ("id", "userId", "sessionId", "questionVersionId", "position", "optionOrder")
      VALUES (${randomUUID()}, ${user.id}, ${session.id}, 'dev-numerical-1-v1', 1, ARRAY[]::text[])
    `;
  })).rejects.toThrow(/Option order must contain each version option exactly once|SessionItem_position/);
});

test('continues to reject an empty workedSteps array', async () => {
  await expect(rejectedWrite(async tx => {
    const questionVersionId = await draftWithExplanation(tx);
    await tx.$executeRaw`
      INSERT INTO "ExplanationVersion" ("id", "questionVersionId", "version", "shortText", "distractorRationales", "workedSteps")
      VALUES (${randomUUID()}, ${questionVersionId}, 2, 'Synthetic empty steps.', '{}'::jsonb, ARRAY[]::text[])
    `;
  })).rejects.toThrow(/ExplanationVersion_review/);
});

test.each([
  ['LEARN', 'MOCK'], ['LEARN', 'DAILY'], ['LEARN', 'PRACTICE'], ['LEARN', 'REVIEW'], ['PRACTICE', 'MOCK'],
] as const)('rejects parent mode change from %s to %s after a valid item exists', async (originalMode, nextMode) => {
  await expect(rejectedWrite(async tx => {
    const { session, item } = await sessionWithItem(tx, originalMode);
    expect(item.solutionRelease).toBe(originalMode === 'LEARN' ? 'WORKED_EXAMPLE' : 'AFTER_ANSWER');
    // Same-mode writes and ordinary state changes remain valid positive controls.
    await tx.practiceSession.update({ where: { id: session.id }, data: { mode: originalMode, state: 'IN_PROGRESS' } });
    await tx.practiceSession.update({ where: { id: session.id }, data: { mode: nextMode } });
  })).rejects.toThrow(/session mode.*immutable/i);
});
