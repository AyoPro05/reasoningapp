import { describe, expect, test } from 'vitest';
import { authorizeSupport } from '../../apps/api/src/modules/learning-support/authorization.js';
import { nextReview } from '../../apps/api/src/modules/personalization/review-scheduler.js';

const actor = { userId: 'owner' };
const modes = ['LEARN', 'PRACTICE', 'MOCK', 'DAILY', 'REVIEW'] as const;
const states = ['CREATED', 'IN_PROGRESS', 'SUBMITTED', 'SCORED', 'EXPIRED', 'ABANDONED'] as const;
const actions = ['HINT', 'EXPLANATION', 'WORKED_STEPS', 'DISTRACTOR', 'CLARIFY_TERM', 'RELATED_PRACTICE'] as const;
const baseSession = { id: 'session', userId: 'owner', expiresAt: null };
const baseItem = {
  id: 'item', userId: 'owner', sessionId: 'session', questionVersionId: 'version',
  solutionRelease: 'AFTER_ANSWER' as const, response: null,
};
const committed = { optionKey: 'a', questionVersionId: 'version', correct: true };

// Expected permissions are literal rows, independent of the policy implementation.
// Each cell lists allowed actions in CREATED / IN_PROGRESS / SUBMITTED / SCORED /
// EXPIRED / ABANDONED. Mock/Daily items always have AFTER_SCORING release.
const hintOnly = ['HINT'] as const;
const feedback = ['EXPLANATION', 'WORKED_STEPS', 'DISTRACTOR', 'CLARIFY_TERM', 'RELATED_PRACTICE'] as const;
const none: readonly string[] = [];
const before = {
  LEARN: [hintOnly, hintOnly, none, none, none, none],
  PRACTICE: [hintOnly, hintOnly, none, none, none, none],
  REVIEW: [hintOnly, hintOnly, none, none, none, none],
  MOCK: [none, none, none, feedback, none, none],
  DAILY: [none, none, none, feedback, none, none],
} as const;
const after = {
  LEARN: [feedback, feedback, feedback, feedback, none, none],
  PRACTICE: [feedback, feedback, feedback, feedback, none, none],
  REVIEW: [feedback, feedback, feedback, feedback, none, none],
  MOCK: [none, none, none, feedback, none, none],
  DAILY: [none, none, none, feedback, none, none],
} as const;

describe('persisted mode/state/action policy', () => {
  for (const mode of modes) for (const [stateIndex, state] of states.entries()) {
    for (const action of actions) for (const answered of [false, true]) {
      const allowed: readonly string[] = (answered ? after : before)[mode][stateIndex]!;
      const permitted = allowed.includes(action);
      test(`${mode} ${state} ${action} ${answered ? 'committed' : 'unanswered'}: ${permitted ? 'allow' : 'block'}`, () => {
        const session = { ...baseSession, mode, state };
        const item = {
          ...baseItem, response: answered ? committed : null,
          solutionRelease: mode === 'MOCK' || mode === 'DAILY' ? 'AFTER_SCORING' as const : 'AFTER_ANSWER' as const,
        };
        const call = () => authorizeSupport(actor, session, item, action);
        if (!permitted) expect(call).toThrow(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
        else expect(call()).toMatchObject({ assistanceStage: action === 'HINT' ? 'BEFORE_ANSWER' :
          mode === 'MOCK' || mode === 'DAILY' || state === 'SCORED' ? 'AFTER_SCORING' : 'AFTER_ANSWER' });
      });
    }
  }
});

test('ownership and exact membership fail uniformly before policy evaluation', () => {
  const session = { ...baseSession, mode: 'MOCK' as const, state: 'IN_PROGRESS' as const };
  for (const item of [
    { ...baseItem, sessionId: 'another-session' }, { ...baseItem, userId: 'another-user' },
    { ...baseItem, questionVersionId: '' },
    { ...baseItem, response: { ...committed, questionVersionId: 'another-version' } },
  ]) expect(() => authorizeSupport(actor, session, item, 'EXPLANATION'))
    .toThrow(expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }));
  expect(() => authorizeSupport({ userId: 'foreign' }, session, baseItem, 'HINT'))
    .toThrow(expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }));
});

test('a passed persisted deadline cannot release an apparently active session', () => {
  for (const action of actions) expect(() => authorizeSupport(actor, {
    ...baseSession, mode: 'PRACTICE', state: 'IN_PROGRESS', expiresAt: new Date(0),
  }, { ...baseItem, response: committed }, action))
    .toThrow(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
});

test('pinned AFTER_SCORING release is honoured even for a committed practice answer', () => {
  for (const state of ['CREATED', 'IN_PROGRESS', 'SUBMITTED'] as const) {
    expect(() => authorizeSupport(actor, { ...baseSession, mode: 'PRACTICE', state }, {
      ...baseItem, response: committed, solutionRelease: 'AFTER_SCORING',
    }, 'EXPLANATION')).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  }
});

test('only a designated persisted Learn worked example permits a pre-answer solution', () => {
  const example = { ...baseItem, solutionRelease: 'WORKED_EXAMPLE' as const };
  for (const action of feedback) expect(authorizeSupport(actor, {
    ...baseSession, mode: 'LEARN', state: 'IN_PROGRESS',
  }, example, action)).toMatchObject({ assistanceStage: 'WORKED_EXAMPLE' });
  for (const mode of ['PRACTICE', 'REVIEW', 'MOCK', 'DAILY'] as const) {
    expect(() => authorizeSupport(actor, { ...baseSession, mode, state: 'IN_PROGRESS' }, example, 'EXPLANATION'))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  }
});

test.each([
  ['CREATED', false, 'WORKED_EXAMPLE'], ['CREATED', true, 'AFTER_ANSWER'],
  ['IN_PROGRESS', false, 'WORKED_EXAMPLE'], ['IN_PROGRESS', true, 'AFTER_ANSWER'],
  ['SUBMITTED', false, 'WORKED_EXAMPLE'], ['SUBMITTED', true, 'AFTER_ANSWER'],
  ['SCORED', false, 'AFTER_SCORING'], ['SCORED', true, 'AFTER_SCORING'],
  ['EXPIRED', false, null], ['EXPIRED', true, null],
  ['ABANDONED', false, null], ['ABANDONED', true, null],
] as const)('worked-example timing in %s with committed=%s is %s', (state, answered, expectedStage) => {
  const session = { ...baseSession, mode: 'LEARN' as const, state };
  const item = { ...baseItem, solutionRelease: 'WORKED_EXAMPLE' as const, response: answered ? committed : null };
  for (const action of feedback) {
    const call = () => authorizeSupport(actor, session, item, action);
    if (expectedStage === null) expect(call).toThrow(expect.objectContaining({ code: 'FORBIDDEN', statusCode: 403 }));
    else expect(call()).toMatchObject({ assistanceStage: expectedStage });
  }
});

describe('documented 1/3/7 day independent retrieval heuristic', () => {
  const now = new Date('2026-11-10T12:30:00.000Z');
  test.each([
    [true, null, 1, '2026-11-11T12:30:00.000Z'],
    [true, 1, 3, '2026-11-13T12:30:00.000Z'],
    [true, 3, 7, '2026-11-17T12:30:00.000Z'],
    [true, 7, 7, '2026-11-17T12:30:00.000Z'],
    [false, null, 1, '2026-11-11T12:30:00.000Z'],
    [false, 1, 1, '2026-11-11T12:30:00.000Z'],
    [false, 3, 1, '2026-11-11T12:30:00.000Z'],
    [false, 7, 1, '2026-11-11T12:30:00.000Z'],
  ] as const)('outcome %s after %s days schedules %s days', (outcome, previous, intervalDays, due) => {
    const result = nextReview(outcome, previous, now);
    expect(result).toMatchObject({ intervalDays, dueAt: new Date(due), policyVersion: 'static-review-v1' });
    expect(now.toISOString()).toBe('2026-11-10T12:30:00.000Z');
  });
  test('a late independent success still advances from its actual retrieval time', () => {
    expect(nextReview(true, 3, new Date('2027-01-01T09:00:00.000Z'))).toMatchObject({
      intervalDays: 7, dueAt: new Date('2027-01-08T09:00:00.000Z'),
    });
  });
});
