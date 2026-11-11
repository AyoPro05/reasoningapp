import { CategoryId, ProgressDto, SessionMode } from '@reasoningapp/contracts';
import type { DatabaseClient } from '@reasoningapp/database';
import { withOwnerTransaction, type StoredItem, type Transaction } from '../sessions/repository.js';
import { nextReview } from './review-scheduler.js';

export async function assistanceAtCommit(tx: Transaction, itemId: string) {
  const events = await tx.learningSupportEvent.findMany({ where: { sessionItemId: itemId,
    assistanceStage: { in: ['BEFORE_ANSWER', 'WORKED_EXAMPLE'] } }, select: { action: true, hintStage: true } });
  if (events.some(e => e.action !== 'HINT')) return { assistanceLevel: 'SOLUTION_REVEALED' as const, assistanceSource: 'STATIC_SOLUTION' };
  const stage = Math.max(0, ...events.map(e => e.hintStage ?? 0));
  return { assistanceLevel: (['INDEPENDENT', 'HINT_1', 'HINT_2', 'HINT_3'] as const)[stage]!,
    assistanceSource: stage ? 'AUTHORED_HINT' : null };
}

/** Called only on first immutable response creation, or first grading of a
 * deferred assessment response. Enclosing owner/session locks make this atomic
 * with response, outbox and replay writes; GET/help/retry never calls it.
 */
export async function recordRetrieval(tx: Transaction, userId: string, item: StoredItem,
  correct: boolean, at: Date, assistanceLevel: string) {
  const skillId = item.questionVersion.skills.find(s => s.primary)?.skillId;
  if (!skillId) throw new Error('Missing pinned primary skill');
  const independent = assistanceLevel === 'INDEPENDENT';
  const counts = { independentAttempts: Number(independent), independentCorrect: Number(independent && correct),
    assistedAttempts: Number(!independent), assistedCorrect: Number(!independent && correct), sampleSize: 1 };
  await tx.skillProgress.upsert({ where: { userId_skillId: { userId, skillId } },
    create: { userId, skillId, ...counts, lastAttemptAt: at, lastIndependentAt: independent ? at : null, policyVersion: 'static-progress-v1' },
    update: { independentAttempts: { increment: counts.independentAttempts }, independentCorrect: { increment: counts.independentCorrect },
      assistedAttempts: { increment: counts.assistedAttempts }, assistedCorrect: { increment: counts.assistedCorrect }, sampleSize: { increment: 1 },
      lastAttemptAt: at, ...(independent ? { lastIndependentAt: at } : {}), policyVersion: 'static-progress-v1' },
  });
  if (!independent) return;
  const previous = await tx.reviewSchedule.findUnique({ where: { userId_questionVersionId: { userId, questionVersionId: item.questionVersionId } } });
  const next = nextReview(correct, previous?.intervalDays ?? null, at);
  const data = { ...next, skillId, lastIndependentOutcome: correct, lastIndependentAt: at };
  await tx.reviewSchedule.upsert({ where: { userId_questionVersionId: { userId, questionVersionId: item.questionVersionId } },
    create: { userId, questionVersionId: item.questionVersionId, ...data }, update: data });
}

export function createProgressService(db: DatabaseClient) {
  return {
    getProgress(userId: string) {
      return withOwnerTransaction(db, userId, async tx => {
        // Derive mode-labelled evidence from actual responses, including historical
        // Task 4 rows. Materialised SkillProgress has no mode dimension.
        const responses = await tx.response.findMany({ where: { sessionItem: { userId }, firstAttempt: true, correct: { not: null } },
          select: { correct: true, assistanceLevel: true, sessionItem: { select: { session: { select: { mode: true, state: true, categoryId: true } } } } } });
        const graded = responses.filter(r => !['MOCK', 'DAILY'].includes(r.sessionItem.session.mode) || r.sessionItem.session.state === 'SCORED');
        const due = await tx.reviewSchedule.findMany({ where: { userId, dueAt: { lte: new Date() } },
          select: { questionVersion: { select: { question: { select: { categoryId: true } } } } } });
        function categories(mode?: string) {
          return CategoryId.options.map(categoryId => {
            const evidence = graded.filter(r => r.sessionItem.session.categoryId === categoryId && (!mode || r.sessionItem.session.mode === mode));
            const independent = evidence.filter(r => r.assistanceLevel === 'INDEPENDENT');
            const independentCorrect = independent.filter(r => r.correct === true).length;
            return { categoryId, independentAttempts: independent.length, independentCorrect,
              assistedAttempts: evidence.length - independent.length,
              independentAccuracy: independent.length ? independentCorrect / independent.length : null,
              // Schedules are shared learning tasks, not a mode-specific score.
              dueReviewCount: mode ? 0 : due.filter(r => r.questionVersion.question.categoryId === categoryId).length };
          });
        }
        return ProgressDto.parse({ categories: categories(), byMode: SessionMode.options.map(mode => ({ mode, categories: categories(mode) })) });
      });
    },
  };
}
