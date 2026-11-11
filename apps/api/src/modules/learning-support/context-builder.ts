import { FeedbackDto } from '@reasoningapp/contracts';
import type { AppConfig } from '@reasoningapp/config';
import { isContentEligible, type Prisma } from '@reasoningapp/database';
import { ProductError } from '../../errors.js';
import { AccessError } from '../auth/authorization.js';
import { lockSessionRow, type Transaction } from '../sessions/repository.js';
import { historicalContentAllowed, instructionalContentAllowed, type SupportStage } from './policies.js';

export const supportSessionSelect = {
  id: true, userId: true, mode: true, state: true, expiresAt: true, categoryId: true, scoringVersion: true,
  items: { orderBy: { position: 'asc' }, select: {
    id: true, userId: true, sessionId: true, questionVersionId: true, explanationVersionId: true,
    position: true, optionOrder: true, solutionRelease: true, response: true,
  } },
} satisfies Prisma.PracticeSessionSelect;
export type MinimalSession = Prisma.PracticeSessionGetPayload<{ select: typeof supportSessionSelect }>;
export type MinimalItem = MinimalSession['items'][number];
export const supportVersionSelect = {
  id: true, questionId: true, contentState: true, heldOutMock: true,
  skills: { select: { skillId: true, primary: true } },
} satisfies Prisma.QuestionVersionSelect;
export type SupportVersion = Prisma.QuestionVersionGetPayload<{ select: typeof supportVersionSelect }>;
export type SupportContext = { session: MinimalSession; item: MinimalItem; version: SupportVersion };

export async function lockSupportSession(tx: Transaction, userId: string, sessionId: string): Promise<MinimalSession> {
  await lockSessionRow(tx, userId, sessionId);
  return tx.practiceSession.findUniqueOrThrow({ where: { id: sessionId }, select: supportSessionSelect });
}
export async function buildSupportContext(tx: Transaction, userId: string, sessionId: string, itemId: string): Promise<SupportContext> {
  const session = await lockSupportSession(tx, userId, sessionId);
  const item = session.items.find(item => item.id === itemId && item.userId === userId);
  if (!item) throw new AccessError(404, 'NOT_FOUND');
  const version = await tx.questionVersion.findUnique({ where: { id: item.questionVersionId }, select: supportVersionSelect });
  if (!version || (item.response && item.response.questionVersionId !== version.id)) throw new AccessError(404, 'NOT_FOUND');
  return { session, item, version };
}
export function assertHistoricalContext(context: SupportContext, config: AppConfig) {
  if (!historicalContentAllowed(context.version.contentState, config)) throw new ProductError('UNAVAILABLE');
}

/** Separate authorised solution load. Never call this for a hint or disabled tutor. */
export async function loadAuthorisedSolution(tx: Transaction, context: SupportContext, assistanceStage: SupportStage, config: AppConfig) {
  const { session, item, version } = context;
  assertHistoricalContext(context, config);
  if (!item.explanationVersionId) throw new ProductError('UNAVAILABLE');
  const workedExample = item.solutionRelease === 'WORKED_EXAMPLE';
  // Designation and feedback release follow the pinned rule even when the
  // opening itself is post-answer or post-scoring review.
  if (workedExample) {
    const lesson = await tx.lesson.findFirst({ where: { workedExampleQuestionVersionId: version.id,
      solutionRelease: 'WORKED_EXAMPLE', categoryId: session.categoryId,
      contentState: { in: isContentEligible('DEVELOPMENT', config) ? ['PUBLISHED', 'DEVELOPMENT'] : ['PUBLISHED'] },
    }, select: { id: true } });
    if (!lesson) throw new ProductError('UNAVAILABLE');
  }
  const explanation = await tx.explanationVersion.findUnique({ where: { id: item.explanationVersionId } });
  const key = await tx.answerKey.findUnique({ where: { questionVersionId: version.id } });
  if (!explanation || explanation.questionVersionId !== version.id ||
      !instructionalContentAllowed(version.contentState, explanation, config) ||
      !key || key.scoringVersion !== session.scoringVersion || session.scoringVersion !== 'option-v1' ||
      !item.optionOrder.includes(key.optionKey) ||
      (item.response?.correct !== null && item.response?.correct !== undefined &&
        item.response.correct !== (item.response.optionKey === key.optionKey))) throw new ProductError('UNAVAILABLE');
  const rationales = explanation.distractorRationales;
  const note = item.response && item.response.optionKey !== key.optionKey && rationales && typeof rationales === 'object' && !Array.isArray(rationales)
    ? rationales[item.response.optionKey] : null;
  const feedback = FeedbackDto.safeParse({
    sessionItemId: item.id, questionVersionId: version.id,
    release: workedExample ? 'WORKED_EXAMPLE' : assistanceStage === 'AFTER_SCORING' ? 'AFTER_SCORING' : 'COMMITTED_RESPONSE',
    correctOptionKey: key.optionKey, selectedOptionKey: item.response?.optionKey ?? null,
    correct: item.response?.correct ?? null, explanation: explanation.shortText, steps: explanation.workedSteps,
    misconceptionNote: typeof note === 'string' ? note : null,
  });
  if (!feedback.success) throw new ProductError('UNAVAILABLE');
  return feedback.data;
}
