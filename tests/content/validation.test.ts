import { expect, test } from 'vitest';
import { validateQuestion } from '../../packages/question-validation/src/index.js';
import { developmentQuestions } from '../../packages/database/src/fixtures/index.js';

const question = {
  id: 'qv-test', questionId: 'q-test', version: 1, categoryId: 'numerical', skillId: 'unit-rate',
  stimulus: 'A pump moves 12 litres in 3 minutes. What is its rate in litres per minute? Give an exact whole number.',
  diagram: null, options: [{ key: 'a', text: '4 litres per minute' }, { key: 'b', text: '9 litres per minute' }], correctOptionKey: 'a',
  explanation: { version: 1, shortText: 'Divide volume by elapsed time.', workedSteps: ['12 ÷ 3 = 4 litres per minute.'], distractorRationales: { b: 'Subtracting time from volume mixes unlike units.' }, review: { status: 'PENDING', reviewerId: null, reviewedAt: null } },
  hints: [{ stage: 1, text: 'Recall the meaning of a rate.' }, { stage: 2, text: 'Relate volume to elapsed time.' }, { stage: 3, text: 'Divide the stated volume by the number of minutes.' }].map(h => ({ ...h, review: { status: 'PENDING', reviewerId: null, reviewedAt: null } })),
  provenance: { kind: 'ORIGINAL_DEVELOPMENT', author: 'ReasoningApp development authoring', source: 'Original local sample; no employer material.' },
  review: { status: 'PENDING', reviewerId: null, reviewedAt: null }, contentState: 'DEVELOPMENT',
  assumptions: ['The rate is constant.'], numerical: { units: 'litres per minute', rounding: 'exact whole number', reviewStatus: 'PENDING' },
};

test('validates private authoring input and rejects absent or disclosing hints', () => {
  expect(validateQuestion(question)).toEqual([]);
  expect(validateQuestion({ ...question, correctOptionKey: 'foreign' }).map(i => i.code)).toContain('KEY_MEMBERSHIP');
  expect(validateQuestion({ ...question, hints: question.hints.slice(1) }).length).toBeGreaterThan(0);
  expect(validateQuestion({ ...question, hints: [{ stage: 1, text: '' }, ...question.hints.slice(1)] }).length).toBeGreaterThan(0);
  expect(validateQuestion({ ...question, hints: [{ ...question.hints[0], stage: 1, text: 'The answer is option a.' }, ...question.hints.slice(1)] }).map(i => i.code)).toContain('HINT_DISCLOSURE');
});

test('does not allow pending development content to claim numeric or alternative-answer approval', () => {
  const numerical = developmentQuestions.find(q => q.categoryId === 'numerical')!;
  const sequence = developmentQuestions.find(q => q.categoryId === 'inductive')!;
  expect(validateQuestion({ ...numerical, numerical: { ...numerical.numerical, reviewStatus: 'APPROVED' } }).map(i => i.code)).toContain('DEVELOPMENT_REVIEW');
  expect(validateQuestion({ ...sequence, sequence: { ...sequence.sequence, alternativeAnswerReview: 'APPROVED' } }).map(i => i.code)).toContain('DEVELOPMENT_REVIEW');
});

test('rejects incomplete category evidence and malformed private authoring records', () => {
  const of = (category: string) => structuredClone(developmentQuestions.find(q => q.categoryId === category)!);
  const numerical = of('numerical');
  numerical.stimulus = 'Find the rate.';
  expect(validateQuestion(numerical).map(i => i.code)).toContain('NUMERICAL_UNITS');
  const verbal = of('verbal');
  verbal.options[2]!.text = 'Unknown';
  expect(validateQuestion(verbal).map(i => i.code)).toContain('VERBAL_CANNOT_SAY');
  const inductive = of('inductive');
  inductive.sequence!.transitions.pop();
  expect(validateQuestion(inductive).map(i => i.code)).toContain('FULL_SEQUENCE_RULE');
  const logical = of('logical');
  delete logical.logical;
  expect(validateQuestion(logical).map(i => i.code)).toContain('LOGICAL_BOUNDARY');
  const mechanical = of('mechanical');
  mechanical.assumptions = ['A different set of assumptions.'];
  expect(validateQuestion(mechanical).map(i => i.code)).toContain('MECHANICAL_ASSUMPTIONS');
  const duplicate = of('numerical');
  duplicate.options[1]!.key = duplicate.options[0]!.key;
  expect(validateQuestion(duplicate).map(i => i.code)).toContain('DUPLICATE_OPTION');
  const empty = of('logical');
  empty.explanation.shortText = ' ';
  empty.provenance.source = '';
  expect(validateQuestion(empty).length).toBeGreaterThan(0);
  const reordered = of('verbal');
  reordered.hints.reverse();
  expect(validateQuestion(reordered).map(i => i.code)).toContain('HINT_STAGES');
  const disclosing = of('numerical');
  disclosing.hints[2]!.text = 'The answer is option a.';
  expect(validateQuestion(disclosing).find(i => i.code === 'HINT_DISCLOSURE')?.severity).toBe('ADVISORY');
});
