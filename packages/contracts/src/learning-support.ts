import { z } from 'zod';
import { CategoryId, ContentLabel, OpaqueId, OptionKey, PublicSessionItem, SessionMode } from './session.js';

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

export const ProgressDto = z.strictObject({
  categories: z.array(CategoryProgress).max(5),
  byMode: z.array(z.strictObject({ mode: SessionMode, categories: z.array(CategoryProgress).max(5) })).max(5).optional(),
})
  .refine((progress) => new Set(progress.categories.map((category) => category.categoryId)).size === progress.categories.length, { message: 'Progress categories must be unique' });
export type ProgressDto = z.infer<typeof ProgressDto>;

export const TutorInput = z.strictObject({ action: z.enum(['EXPLANATION', 'WORKED_STEPS', 'DISTRACTOR', 'CLARIFY_TERM']) });
export const RelatedPracticeInput = z.strictObject({ questionVersionId: OpaqueId });
export const QuestionReportInput = z.strictObject({
  sessionId: OpaqueId, sessionItemId: OpaqueId, questionVersionId: OpaqueId,
  reason: z.string().trim().min(1).max(100), detail: z.string().trim().min(1).max(2_000).optional(),
});
export type QuestionReportInput = z.infer<typeof QuestionReportInput>;
export const QuestionReportDto = z.strictObject({ id: OpaqueId, status: z.literal('OPEN'), messageKey: z.literal('learningSupport.reportReceived') });
export const SupportUnavailableDto = z.strictObject({ status: z.literal('UNAVAILABLE'), messageKey: z.enum([
  'learningSupport.hintsExhausted', 'learningSupport.hintUnavailable', 'learningSupport.relatedUnavailable',
  'learningSupport.finishActiveSession', 'learningSupport.sessionFull',
]) });
export const HintDto = z.union([SupportUnavailableDto, z.strictObject({
  status: z.literal('AVAILABLE'), sessionItemId: OpaqueId, questionVersionId: OpaqueId,
  stage: z.number().int().min(1).max(3), text: Text, contentLabel: ContentLabel,
})]);
export const RelatedPracticeDto = z.union([SupportUnavailableDto, z.strictObject({
  status: z.literal('AVAILABLE'), item: z.strictObject({
    questionVersionId: OpaqueId, stimulus: PublicSessionItem.shape.stimulus, diagram: PublicSessionItem.shape.diagram,
    options: PublicSessionItem.shape.options, categoryId: CategoryId, skillId: OpaqueId, contentLabel: ContentLabel,
  }),
  action: z.strictObject({ method: z.literal('POST'), href: z.string().max(1_024).regex(/^\/v1\/sessions\//), body: RelatedPracticeInput }),
})]);
export const RelatedPracticeTargetDto = z.strictObject({ sessionId: OpaqueId, sessionItemId: OpaqueId, item: PublicSessionItem });
const SummaryLine = z.strictObject({ messageKey: z.string().regex(/^learningSummary\./), text: Text });
export const LearningSummaryDto = z.strictObject({
  sessionId: OpaqueId, mode: SessionMode, improved: SummaryLine, revisit: SummaryLine, nextAction: SummaryLine,
  evidence: z.strictObject({
    itemCount: z.number().int().nonnegative(), committedCount: z.number().int().nonnegative(),
    independentAttempts: z.number().int().nonnegative(), independentCorrect: z.number().int().nonnegative(),
    assistedAttempts: z.number().int().nonnegative(), independentAccuracy: z.number().min(0).max(1).nullable(),
    postAnswerHelpCount: z.number().int().nonnegative(),
  }),
});

/** UK English client copy. Counts are evidence, never a claim of test readiness. */
export const learningMessages = {
  'learningSummary.insufficientEvidence': 'There is not enough comparable evidence to describe improvement.',
  'learningSummary.revisit': 'Revisit {misses} independent mistakes and {assisted} questions answered with help in this session.',
  'learningSummary.noMistakes': 'No independent mistakes are recorded in this session. This does not establish mastery.',
  'learningSummary.continue': 'Try a remaining question independently. There are {remaining} questions left in this session.',
  'learningSummary.complete': 'Try a different related question independently, then return to the skill later.',
  'learningSummary.finishAssessment': 'Complete the whole assessment before reviewing solutions.',
  'learningSummary.sessionClosed': 'Start another practice session when you are ready.',
  'learningSupport.hintsExhausted': 'You have reached the end of the hint ladder.',
  'learningSupport.hintUnavailable': 'An authored hint is unavailable. You can report this question for review.',
  'learningSupport.relatedUnavailable': 'A different eligible practice question is unavailable.',
  'learningSupport.finishActiveSession': 'Finish your active session before starting this related practice.',
  'learningSupport.sessionFull': 'This session has reached its question limit. Finish it before starting more practice.',
  'learningSupport.reportReceived': 'Your question report has been saved for review. Official scoring is unchanged.',
} as const;
