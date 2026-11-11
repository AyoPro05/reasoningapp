import { z } from 'zod';
import { QuestionDiagram } from '@reasoningapp/question-render-spec';

export const OpaqueId = z.string().trim().min(1).max(128);
export const CategoryId = z.enum(['inductive', 'logical', 'numerical', 'verbal', 'mechanical']);
export type CategoryId = z.infer<typeof CategoryId>;
export const SessionMode = z.enum(['LEARN', 'PRACTICE', 'MOCK', 'DAILY', 'REVIEW']);
export type SessionMode = z.infer<typeof SessionMode>;
export const SessionState = z.enum(['CREATED', 'IN_PROGRESS', 'SUBMITTED', 'SCORED', 'EXPIRED', 'ABANDONED']);
export type SessionState = z.infer<typeof SessionState>;
export const OptionKey = z.string().trim().min(1).max(64);
export const Timestamp = z.iso.datetime();

export const CreateSessionInput = z.strictObject({ categoryId: CategoryId, mode: SessionMode });
export type CreateSessionInput = z.infer<typeof CreateSessionInput>;
export const CommitAnswerInput = z.strictObject({
  optionKey: OptionKey, selfReportedReason: z.string().trim().min(1).max(300).optional(),
});
export type CommitAnswerInput = z.infer<typeof CommitAnswerInput>;

export const ContentLabel = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('DEVELOPMENT'), labelKey: z.literal('content.developmentUnreviewed') }),
  z.strictObject({ kind: z.literal('REVIEWED'), labelKey: z.literal('content.reviewed') }),
]);

// A schema validates shape only. The server must establish content eligibility and release authority.
export const PublicSessionItem = z.strictObject({
  sessionItemId: OpaqueId, questionVersionId: OpaqueId,
  stimulus: z.string().trim().min(1).max(20_000), diagram: QuestionDiagram.nullable(),
  options: z.array(z.strictObject({ key: OptionKey, text: z.string().trim().min(1).max(5_000) })).min(2).max(10),
  categoryId: CategoryId, skillId: OpaqueId, contentLabel: ContentLabel,
  committedResponse: z.strictObject({ optionKey: OptionKey, committedAt: Timestamp }).nullable(),
}).superRefine((item, context) => {
  const keys = new Set(item.options.map((option) => option.key));
  if (keys.size !== item.options.length) context.addIssue({ code: 'custom', path: ['options'], message: 'Option keys must be unique' });
  if (item.committedResponse && !keys.has(item.committedResponse.optionKey)) {
    context.addIssue({ code: 'custom', path: ['committedResponse'], message: 'Committed option must belong to this item' });
  }
});
export type PublicSessionItem = z.infer<typeof PublicSessionItem>;

export const SessionDto = z.strictObject({
  id: OpaqueId, mode: SessionMode, state: SessionState, categoryId: CategoryId,
  items: z.array(PublicSessionItem).max(200), createdAt: Timestamp,
  expiresAt: Timestamp.nullable(), submittedAt: Timestamp.nullable(), scoredAt: Timestamp.nullable(),
}).refine((session) => new Set(session.items.map((item) => item.sessionItemId)).size === session.items.length, { message: 'Session item identifiers must be unique' });
export type SessionDto = z.infer<typeof SessionDto>;

export const EmptySessionMutationInput = z.strictObject({});
export const ActiveSessionDto = z.strictObject({ session: SessionDto.nullable() });
export type ActiveSessionDto = z.infer<typeof ActiveSessionDto>;

export const SessionResultDto = z.strictObject({
  sessionId: OpaqueId, total: z.number().int().positive(), correct: z.number().int().nonnegative(),
  independentAttempts: z.number().int().nonnegative(), independentCorrect: z.number().int().nonnegative(),
  assistedAttempts: z.number().int().nonnegative(), scoredAt: Timestamp,
}).refine(result => result.correct <= result.total &&
  result.independentAttempts + result.assistedAttempts === result.total &&
  result.independentCorrect <= result.independentAttempts && result.independentCorrect <= result.correct,
{ message: 'Result counts must agree' });
export type SessionResultDto = z.infer<typeof SessionResultDto>;

export const ApiErrorDto = z.strictObject({
  code: z.enum(['INVALID_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'AI_DISABLED', 'UNAVAILABLE', 'INTERNAL_ERROR']),
  messageKey: z.string().regex(/^errors\.[A-Za-z][A-Za-z0-9.]*$/), requestId: OpaqueId,
});
export type ApiErrorDto = z.infer<typeof ApiErrorDto>;
