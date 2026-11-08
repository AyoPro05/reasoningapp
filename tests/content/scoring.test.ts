import { expect, test } from 'vitest';
import { scoreOption } from '../../packages/scoring-engine/src/index.js';

test('scores only a key belonging to this immutable version', () => {
  const version = { options: [{ key: 'left', text: '12' }, { key: 'right', text: '16' }], correctOptionKey: 'right' };
  expect(scoreOption(version, 'right')).toEqual({ correct: true });
  expect(scoreOption(version, 'left')).toEqual({ correct: false });
  expect(() => scoreOption(version, 'other-version')).toThrow();
  expect(() => scoreOption({ ...version, correctOptionKey: 'missing' }, 'left')).toThrow();
});
