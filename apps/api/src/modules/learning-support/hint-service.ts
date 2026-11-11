import type { AppConfig } from '@reasoningapp/config';
import { HintDto, QuestionReportDto, type QuestionReportInput } from '@reasoningapp/contracts';
import type { DatabaseClient } from '@reasoningapp/database';
import { AccessError } from '../auth/authorization.js';
import { mutationHash, readReplay, saveReplay, toJson, withOwnerTransaction, type MutationOutcome } from '../sessions/repository.js';
import { contentLabel } from '../sessions/serialization.js';
import { authorizeSupport } from './authorization.js';
import { assertHistoricalContext, buildSupportContext, loadAuthorisedSolution } from './context-builder.js';
import { instructionalContentAllowed } from './policies.js';
import { disabledTutor } from './tutor-service.js';

export function createSupportService(db: DatabaseClient, config: AppConfig) {
  return {
    hint(userId: string, sessionId: string, itemId: string, key: string) {
      const operation = 'support.hint', hash = mutationHash(operation, { sessionId, itemId }, {});
      return withOwnerTransaction(db, userId, async tx => {
        const context = await buildSupportContext(tx, userId, sessionId, itemId);
        const replay = await readReplay(tx, userId, key, operation, hash);
        // An original hint may be retried after the immutable answer boundary.
        // Current ownership, entitlement, mode, deadline and release still apply.
        authorizeSupport({ userId }, context.session, replay ? { ...context.item, response: null } : context.item, 'HINT');
        assertHistoricalContext(context, config);
        if (replay) return replay;
        const prior = await tx.learningSupportEvent.aggregate({ where: { sessionItemId: itemId, action: 'HINT' }, _max: { hintStage: true } });
        const stage = (prior._max.hintStage ?? 0) + 1;
        let body: unknown;
        if (stage > 3) body = { status: 'UNAVAILABLE', messageKey: 'learningSupport.hintsExhausted' };
        else {
          // Only the next stage's text is read, after owner/session locks.
          const hint = await tx.approvedHint.findUnique({ where: { questionVersionId_stage: { questionVersionId: context.version.id, stage } } });
          if (!hint || !instructionalContentAllowed(context.version.contentState, hint, config)) {
            body = { status: 'UNAVAILABLE', messageKey: 'learningSupport.hintUnavailable' };
          } else {
            await tx.learningSupportEvent.create({ data: { userId, sessionItemId: itemId, questionVersionId: context.version.id,
              action: 'HINT', assistanceStage: 'BEFORE_ANSWER', hintStage: stage, hintId: hint.id } });
            body = { status: 'AVAILABLE', sessionItemId: itemId, questionVersionId: context.version.id,
              stage, text: hint.text, contentLabel: contentLabel(context.version.contentState) };
          }
        }
        const outcome = { status: 200, body: toJson(HintDto.parse(body)) };
        await saveReplay(tx, userId, sessionId, key, operation, hash, outcome);
        return outcome;
      });
    },

    explanation(userId: string, sessionId: string, itemId: string, key: string) {
      const operation = 'support.explanation', hash = mutationHash(operation, { sessionId, itemId }, {});
      return withOwnerTransaction(db, userId, async tx => {
        const context = await buildSupportContext(tx, userId, sessionId, itemId);
        const { assistanceStage } = authorizeSupport({ userId }, context.session, context.item, 'EXPLANATION');
        // Validate the pinned context even when replaying a released DTO.
        const feedback = await loadAuthorisedSolution(tx, context, assistanceStage, config);
        const replay = await readReplay(tx, userId, key, operation, hash);
        if (replay) return replay;
        await tx.learningSupportEvent.create({ data: { userId, sessionItemId: itemId, questionVersionId: context.version.id,
          action: 'EXPLANATION', assistanceStage } });
        const outcome: MutationOutcome = { status: 200, body: toJson(feedback) };
        await saveReplay(tx, userId, sessionId, key, operation, hash, outcome);
        return outcome;
      });
    },

    tutor(userId: string, sessionId: string, itemId: string, action: 'EXPLANATION' | 'WORKED_STEPS' | 'DISTRACTOR' | 'CLARIFY_TERM') {
      return withOwnerTransaction(db, userId, async tx => {
        const context = await buildSupportContext(tx, userId, sessionId, itemId);
        return disabledTutor(userId, context, action);
      });
    },

    report(userId: string, key: string, input: QuestionReportInput) {
      const { sessionId, sessionItemId: itemId } = input;
      const operation = 'support.report', hash = mutationHash(operation, { sessionId, itemId }, input);
      return withOwnerTransaction(db, userId, async tx => {
        const context = await buildSupportContext(tx, userId, sessionId, itemId);
        if (context.version.id !== input.questionVersionId) throw new AccessError(404, 'NOT_FOUND');
        const replay = await readReplay(tx, userId, key, operation, hash);
        if (replay) return replay;
        const report = await tx.questionReport.create({ data: { userId, sessionItemId: itemId,
          questionVersionId: input.questionVersionId, reason: input.reason,
          ...(input.detail === undefined ? {} : { detail: input.detail }) } });
        const outcome = { status: 201, body: toJson(QuestionReportDto.parse({
          id: report.id, status: report.status, messageKey: 'learningSupport.reportReceived',
        })) };
        await saveReplay(tx, userId, sessionId, key, operation, hash, outcome);
        return outcome;
      });
    },
  };
}
