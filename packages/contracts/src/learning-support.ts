import { z } from 'zod';
import { CategoryId, OpaqueId, OptionKey } from './session.js';

const Text = z.string().trim().min(1).max(10_000);

/** Only serialise after server ownership, entitlement and persisted release checks. */
export const FeedbackDto = z.strictObject({
  sessionItemId: OpaqueId, questionVersionId: OpaqueId,
  release: z.enum(['COMMITTED_RESPONSE', 'WORKED_EXAMPLE', 'AFTER_SCORING']),
  correctOptionKey: OptionKey, selectedOptionKey: OptionKey.nullable(), correct: z.boolean().nullable(),
  explanation: Text, steps: z.array(Text).max(20), misconceptionNote: Text.nullable(),
});
export type FeedbackDto = z.infer<typeof FeedbackDto>;

const CategoryProgress = z.strictObject({
  categoryId: CategoryId,
  independentAttempts: z.number().int().nonnegative(),
  independentCorrect: z.number().int().nonnegative(),
  assistedAttempts: z.number().int().nonnegative(),
  independentAccuracy: z.number().min(0).max(1).nullable(),
  dueReviewCount: z.number().int().nonnegative(),
}).refine((progress) => {
  if (progress.independentCorrect > progress.independentAttempts) return false;
  if (progress.independentAttempts === 0) return progress.independentAccuracy === null;
  return progress.independentAccuracy !== null && Math.abs(progress.independentAccuracy - progress.independentCorrect / progress.independentAttempts) < 1e-9;
}, { message: 'Independent accuracy must reflect independent attempts; no evidence means null' });

export const ProgressDto = z.strictObject({ categories: z.array(CategoryProgress).max(5) })
  .refine((progress) => new Set(progress.categories.map((category) => category.categoryId)).size === progress.categories.length, { message: 'Progress categories must be unique' });
export type ProgressDto = z.infer<typeof ProgressDto>;
