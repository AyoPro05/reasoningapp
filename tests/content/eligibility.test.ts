import { expect, test } from 'vitest';
import { assertDevelopmentSeedAllowed, isContentEligible } from '../../packages/database/src/content-policy.js';

test('requires explicit local flags and fails closed in production regardless of fixture bypass flags', () => {
  const development = { environment: 'development' as const, developmentFixturesEnabled: true, allowUnreviewedContent: true };
  expect(() => assertDevelopmentSeedAllowed(development)).not.toThrow();
  expect(() => assertDevelopmentSeedAllowed({ ...development, developmentFixturesEnabled: false })).toThrow();
  expect(() => assertDevelopmentSeedAllowed({ ...development, allowUnreviewedContent: false })).toThrow();
  expect(() => assertDevelopmentSeedAllowed({ ...development, environment: 'production' })).toThrow();
  expect(isContentEligible('DEVELOPMENT', development)).toBe(true);
  expect(isContentEligible('DEVELOPMENT', { ...development, environment: 'production' })).toBe(false);
  expect(isContentEligible('DRAFT', development)).toBe(false);
  expect(isContentEligible('RETIRED', development)).toBe(false);
  expect(isContentEligible('PUBLISHED', { ...development, environment: 'production' })).toBe(true);
});
