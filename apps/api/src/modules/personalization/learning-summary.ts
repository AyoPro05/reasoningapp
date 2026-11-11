import { LearningSummaryDto, learningMessages } from '@reasoningapp/contracts';
import type { DatabaseClient } from '@reasoningapp/database';
import { withOwnerTransaction } from '../sessions/repository.js';
import { lockSupportSession } from '../learning-support/context-builder.js';

function line(messageKey: keyof typeof learningMessages, params: Record<string, number> = {}) {
  const text = learningMessages[messageKey].replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? 0));
  return { messageKey, text };
}
export function createLearningSummaryService(db: DatabaseClient) {
  return {
    getLearningSummary(sessionId: string, userId: string) {
      return withOwnerTransaction(db, userId, async tx => {
        const session = await lockSupportSession(tx, userId, sessionId);
        const assessmentBlocked = ['MOCK', 'DAILY'].includes(session.mode) && session.state !== 'SCORED';
        const committed = session.items.filter(i => i.response);
        const graded = assessmentBlocked ? [] : committed.filter(i => i.response!.correct !== null && i.response!.firstAttempt);
        const independent = graded.filter(i => i.response!.assistanceLevel === 'INDEPENDENT');
        const independentCorrect = independent.filter(i => i.response!.correct).length;
        const assistedAttempts = graded.length - independent.length;
        const postAnswerHelpCount = await tx.learningSupportEvent.count({ where: { userId, sessionItem: { sessionId },
          assistanceStage: { in: ['AFTER_ANSWER', 'AFTER_SCORING'] } } });
        const misses = independent.length - independentCorrect;
        const remaining = session.items.length - committed.length;
        return LearningSummaryDto.parse({ sessionId, mode: session.mode,
          // No comparable baseline has been established; do not invent a trend.
          improved: line('learningSummary.insufficientEvidence'),
          revisit: misses || assistedAttempts ? line('learningSummary.revisit', { misses, assisted: assistedAttempts }) : line('learningSummary.noMistakes'),
          nextAction: line(['EXPIRED', 'ABANDONED'].includes(session.state) ? 'learningSummary.sessionClosed' :
            assessmentBlocked ? 'learningSummary.finishAssessment' : remaining ? 'learningSummary.continue' : 'learningSummary.complete', { remaining }),
          evidence: { itemCount: session.items.length, committedCount: committed.length,
            independentAttempts: independent.length, independentCorrect, assistedAttempts,
            independentAccuracy: independent.length ? independentCorrect / independent.length : null, postAnswerHelpCount },
        });
      });
    },
  };
}
