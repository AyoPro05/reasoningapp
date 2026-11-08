import { describe, expect, it } from 'vitest';
import {
  ApiErrorDto, CommitAnswerInput, CreateSessionInput, FeedbackDto, ProgressDto, SessionDto,
} from '../../packages/contracts/src/index.js';
import { QuestionDiagram } from '../../packages/question-render-spec/src/index.js';

const item = {
  sessionItemId: 'item-opaque', questionVersionId: 'version-opaque',
  stimulus: 'Which option follows?', diagram: null,
  options: [{ key: 'A', text: 'First option' }, { key: 'B', text: 'Second option' }],
  categoryId: 'inductive', skillId: 'sequence',
  contentLabel: { kind: 'DEVELOPMENT', labelKey: 'content.developmentUnreviewed' },
  committedResponse: null,
};
const session = {
  id: 'session-opaque', mode: 'PRACTICE', state: 'IN_PROGRESS', categoryId: 'inductive',
  items: [item], createdAt: '2026-11-08T12:00:00.000Z',
  expiresAt: null, submittedAt: null, scoredAt: null,
};

describe('public session boundary', () => {
  it.each(['inductive', 'logical', 'numerical', 'verbal', 'mechanical'])('accepts category %s with opaque IDs', (categoryId) => {
    expect(CreateSessionInput.parse({ categoryId, mode: 'PRACTICE' })).toEqual({ categoryId, mode: 'PRACTICE' });
  });
  it.each([
    { categoryId: 'unknown', mode: 'PRACTICE' },
    { categoryId: 'logical', mode: 'ADMIN' },
    { categoryId: 'logical', mode: 'PRACTICE', userId: 'someone-else' },
    { categoryId: 'logical', mode: 'PRACTICE', revealSolution: true },
  ])('rejects invalid or client-controlled authority %j', (input) => {
    expect(CreateSessionInput.safeParse(input).success).toBe(false);
  });
  it('accepts an option and optional self-reported reason', () => {
    expect(CommitAnswerInput.parse({ optionKey: 'B', selfReportedReason: 'I misread the units.' })).toEqual({ optionKey: 'B', selfReportedReason: 'I misread the units.' });
  });
  it.each([{ optionKey: '' }, { optionKey: 'A', correct: true }, { optionKey: 'A', userId: 'foreign' }, { optionKey: 'A', selfReportedReason: 'x'.repeat(301) }])('rejects unsafe answer input %j', (input) => {
    expect(CommitAnswerInput.safeParse(input).success).toBe(false);
  });
  it('preserves server-owned option order and development labelling without releasing a solution', () => {
    expect(SessionDto.parse(session)).toEqual(session);
  });
  it.each(['answerKey', 'correctOptionKey', 'explanation', 'privateExplanation', 'hints'])('rejects leaked item field %s', (field) => {
    expect(SessionDto.safeParse({ ...session, items: [{ ...item, [field]: 'private' }] }).success).toBe(false);
  });
  it('rejects duplicate option keys', () => {
    expect(SessionDto.safeParse({ ...session, items: [{ ...item, options: [{ key: 'A', text: 'One' }, { key: 'A', text: 'Two' }] }] }).success).toBe(false);
  });
  it('rejects duplicate session item identifiers', () => {
    expect(SessionDto.safeParse({ ...session, items: [item, item] }).success).toBe(false);
  });
  it('rejects an answer hydration for an option absent from the item', () => {
    expect(SessionDto.safeParse({ ...session, items: [{ ...item, committedResponse: { optionKey: 'Z', committedAt: '2026-11-08T12:01:00.000Z' } }] }).success).toBe(false);
  });
  it('rejects an invalid session state', () => {
    expect(SessionDto.safeParse({ ...session, state: 'REVIEWED' }).success).toBe(false);
  });
});

describe('authorised feedback and progress contracts', () => {
  const feedback = {
    sessionItemId: 'item-opaque', questionVersionId: 'version-opaque',
    release: 'COMMITTED_RESPONSE', correctOptionKey: 'B', selectedOptionKey: 'A',
    correct: false, explanation: 'Use the stated relationship.', steps: ['Compare adjacent terms.'],
    misconceptionNote: null,
  };
  it('keeps released feedback in a distinct version-specific schema', () => {
    expect(FeedbackDto.parse(feedback)).toEqual(feedback);
    expect(SessionDto.safeParse({ ...session, items: [{ ...item, ...feedback }] }).success).toBe(false);
  });
  it('rejects an invented pre-answer solution release rule', () => {
    expect(FeedbackDto.safeParse({ ...feedback, release: 'BEFORE_ANSWER' }).success).toBe(false);
  });
  it('accepts zero-evidence progress with null independent accuracy', () => {
    const progress = { categories: [{ categoryId: 'logical', independentAttempts: 0, independentCorrect: 0, assistedAttempts: 0, independentAccuracy: null, dueReviewCount: 0 }] };
    expect(ProgressDto.parse(progress)).toEqual(progress);
  });
  it('rejects fabricated accuracy when no independent attempts exist', () => {
    expect(ProgressDto.safeParse({ categories: [{ categoryId: 'logical', independentAttempts: 0, independentCorrect: 0, assistedAttempts: 1, independentAccuracy: 1, dueReviewCount: 0 }] }).success).toBe(false);
  });
  it('rejects independent correct counts beyond attempts', () => {
    expect(ProgressDto.safeParse({ categories: [{ categoryId: 'logical', independentAttempts: 1, independentCorrect: 2, assistedAttempts: 0, independentAccuracy: 1, dueReviewCount: 0 }] }).success).toBe(false);
  });
  it('rejects accuracy inconsistent with independent evidence', () => {
    expect(ProgressDto.safeParse({ categories: [{ categoryId: 'logical', independentAttempts: 2, independentCorrect: 1, assistedAttempts: 1, independentAccuracy: 1, dueReviewCount: 0 }] }).success).toBe(false);
  });
  it('returns structured disabled AI errors using externalised copy', () => {
    expect(ApiErrorDto.parse({ code: 'AI_DISABLED', messageKey: 'errors.aiDisabled', requestId: 'request-opaque' })).toEqual({ code: 'AI_DISABLED', messageKey: 'errors.aiDisabled', requestId: 'request-opaque' });
  });
  it('rejects stack traces and arbitrary details in public errors', () => {
    expect(ApiErrorDto.safeParse({ code: 'INTERNAL_ERROR', messageKey: 'errors.internal', requestId: 'request', stack: 'secret' }).success).toBe(false);
  });
});

describe('framework-neutral diagram boundary', () => {
  it('accepts accessible structured sequences', () => {
    const diagram = { kind: 'sequence', alternativeText: 'A circle followed by a square, then a missing shape.', cells: [{ shape: 'circle', fill: 'outline', rotation: 0 }, { shape: 'square', fill: 'solid', rotation: 90 }, { shape: 'missing' }] };
    expect(QuestionDiagram.parse(diagram)).toEqual(diagram);
  });
  it('rejects diagrams without an accessible alternative', () => {
    expect(QuestionDiagram.safeParse({ kind: 'sequence', cells: [{ shape: 'missing' }] }).success).toBe(false);
  });
  it('rejects ragged structured tables', () => {
    expect(QuestionDiagram.safeParse({ kind: 'table', alternativeText: 'Distances.', columns: ['Car', 'Distance'], rows: [['A']] }).success).toBe(false);
  });
  it('rejects mechanical edges referring to absent parts', () => {
    expect(QuestionDiagram.safeParse({ kind: 'mechanical', alternativeText: 'A pair of gears.', assumptions: ['No slipping.'], parts: [{ id: 'gear-a', kind: 'gear', x: 0, y: 0, label: 'A' }], connections: [{ from: 'gear-a', to: 'unknown', kind: 'meshes' }] }).success).toBe(false);
  });
  it('rejects executable markup as diagram data', () => {
    expect(QuestionDiagram.safeParse({ kind: 'svg', alternativeText: 'Diagram.', markup: '<svg onload="alert(1)"/>' }).success).toBe(false);
  });
});
