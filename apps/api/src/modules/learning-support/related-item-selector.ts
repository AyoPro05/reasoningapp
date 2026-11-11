import type { AppConfig } from '@reasoningapp/config';
import { RelatedPracticeDto } from '@reasoningapp/contracts';
import { isContentEligible, type DatabaseClient, type Prisma } from '@reasoningapp/database';
import { ProductError } from '../../errors.js';
import { AccessError } from '../auth/authorization.js';
import { activeStates, versionInclude, withOwnerTransaction, type BankVersion, type Transaction } from '../sessions/repository.js';
import { presentation } from '../sessions/serialization.js';
import { authorizeSupport } from './authorization.js';
import { assertHistoricalContext, buildSupportContext, supportSessionSelect, type MinimalSession, type SupportContext } from './context-builder.js';
import { instructionalContentAllowed, MAX_SESSION_ITEMS, untimedModes } from './policies.js';

// GET selects only public presentation and instructional approval metadata.
// Keys and explanation text are read solely by the authorised POST start seam.
const publicInclude = {
  question: true, skills: { orderBy: { skillId: 'asc' } }, options: { orderBy: { position: 'asc' } },
  explanations: { orderBy: { version: 'desc' }, select: { id: true, reviewStatus: true, publishedAt: true } },
} satisfies Prisma.QuestionVersionInclude;
type RelatedVersion = Prisma.QuestionVersionGetPayload<{ include: typeof publicInclude }>;

function candidateWhere(context: SupportContext, config: AppConfig): Prisma.QuestionVersionWhereInput {
  const skillId = context.version.skills.find(s => s.primary)?.skillId;
  if (!skillId) throw new ProductError('UNAVAILABLE');
  const development = isContentEligible('DEVELOPMENT', config);
  return {
    questionId: { not: context.version.questionId }, question: { categoryId: context.session.categoryId },
    heldOutMock: false, lessons: { none: {} }, skills: { some: { skillId, primary: true } },
    answerKey: { is: { scoringVersion: 'option-v1' } },
    OR: [
      { contentState: 'PUBLISHED', explanations: { some: { reviewStatus: 'APPROVED', publishedAt: { lte: new Date() } } } },
      ...(development ? [{ contentState: 'DEVELOPMENT' as const, explanations: { some: {} } }] : []),
    ],
  };
}
export function relatedExplanation(version: Pick<BankVersion, 'contentState' | 'explanations'>, config: AppConfig) {
  return version.explanations.find(e => instructionalContentAllowed(version.contentState, e, config));
}

/** Revalidate under the immutable-version row lock immediately before start/replay. */
export async function lockRelatedTarget(tx: Transaction, context: SupportContext, config: AppConfig, id: string): Promise<BankVersion> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "QuestionVersion" WHERE "id" = ${id} FOR UPDATE`;
  if (!rows.length) throw new AccessError(404, 'NOT_FOUND');
  const candidate = await tx.questionVersion.findFirst({ where: { AND: [{ id }, candidateWhere(context, config)] }, include: versionInclude });
  if (!candidate || !candidate.answerKey || candidate.answerKey.scoringVersion !== 'option-v1' || !relatedExplanation(candidate, config)) {
    throw new AccessError(403, 'FORBIDDEN');
  }
  return candidate;
}

export async function activeRelatedSession(tx: Transaction, userId: string): Promise<MinimalSession | null> {
  return tx.practiceSession.findFirst({ where: { userId, state: { in: [...activeStates] } }, select: supportSessionSelect });
}
export function canAnswerIn(session: MinimalSession) {
  return untimedModes.includes(session.mode) && ['CREATED', 'IN_PROGRESS'].includes(session.state) &&
    (!session.expiresAt || session.expiresAt.getTime() > Date.now());
}
export type RelatedDestination = { kind: 'RESUME'; session: MinimalSession; itemId: string } |
  { kind: 'APPEND'; session: MinimalSession } | { kind: 'CREATE' } |
  { kind: 'UNAVAILABLE'; messageKey: 'learningSupport.finishActiveSession' | 'learningSupport.sessionFull' | 'learningSupport.relatedUnavailable' };

export function relatedDestination(source: MinimalSession, active: MinimalSession | null, versionId: string): RelatedDestination {
  if (!active) return source.state === 'SCORED' ? { kind: 'CREATE' } : { kind: 'UNAVAILABLE', messageKey: 'learningSupport.finishActiveSession' };
  if (canAnswerIn(active)) {
    const target = active.items.find(i => i.questionVersionId === versionId && !i.response);
    if (target) return { kind: 'RESUME', session: active, itemId: target.id };
    if (active.id === source.id) {
      if (active.items.some(i => i.questionVersionId === versionId)) return { kind: 'UNAVAILABLE', messageKey: 'learningSupport.relatedUnavailable' };
      if (active.items.length >= MAX_SESSION_ITEMS) return { kind: 'UNAVAILABLE', messageKey: 'learningSupport.sessionFull' };
      return { kind: 'APPEND', session: active };
    }
  }
  return { kind: 'UNAVAILABLE', messageKey: 'learningSupport.finishActiveSession' };
}

export function createRelatedSelector(db: DatabaseClient, config: AppConfig) {
  return {
    select(userId: string, sessionId: string, itemId: string) {
      return withOwnerTransaction(db, userId, async tx => {
        const context = await buildSupportContext(tx, userId, sessionId, itemId);
        authorizeSupport({ userId }, context.session, context.item, 'RELATED_PRACTICE');
        assertHistoricalContext(context, config);
        const active = await activeRelatedSession(tx, userId);
        const candidates = await tx.questionVersion.findMany({ where: candidateWhere(context, config), include: publicInclude, orderBy: { id: 'asc' } });
        // A resumable target is useful even when the source has reached its limit.
        let chosen: RelatedVersion | undefined;
        let reason: RelatedDestination = { kind: 'UNAVAILABLE', messageKey: 'learningSupport.relatedUnavailable' };
        for (const candidate of candidates) {
          const destination = relatedDestination(context.session, active, candidate.id);
          if (destination.kind === 'RESUME') { chosen = candidate; break; }
          if (destination.kind !== 'UNAVAILABLE' && !chosen) chosen = candidate;
          if (destination.kind === 'UNAVAILABLE' && destination.messageKey !== 'learningSupport.relatedUnavailable') reason = destination;
        }
        if (!chosen) return RelatedPracticeDto.parse({ status: 'UNAVAILABLE', messageKey: reason.kind === 'UNAVAILABLE' ? reason.messageKey : 'learningSupport.relatedUnavailable' });
        return RelatedPracticeDto.parse({ status: 'AVAILABLE',
          item: presentation(chosen, chosen.options.map(o => o.optionKey)),
          action: { method: 'POST', href: `/v1/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}/related-practice`, body: { questionVersionId: chosen.id } },
        });
      });
    },
  };
}
