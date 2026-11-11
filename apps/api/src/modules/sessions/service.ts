import type { AppConfig } from '@reasoningapp/config';
import type { CommitAnswerInput, CreateSessionInput } from '@reasoningapp/contracts';
import { isContentEligible, type DatabaseClient } from '@reasoningapp/database';
import { scoreOption } from '@reasoningapp/scoring-engine';
import { ProductError } from '../../errors.js';
import { AccessError } from '../auth/authorization.js';
import {
  enqueueSessionEvent, expireSession, lockActiveSession, lockSession, mutationHash, readReplay, saveReplay, sessionInclude, toJson,
  versionInclude, withOwnerTransaction, type BankVersion, type MutationOutcome, type StoredSession, type Transaction,
} from './repository.js';
import { serializeItem, serializeResult, serializeSession } from './serialization.js';
import { assistanceAtCommit, recordRetrieval } from '../personalization/progress.js';
import { authorizeSupport } from '../learning-support/authorization.js';
import { assertHistoricalContext, type SupportContext } from '../learning-support/context-builder.js';
import { activeRelatedSession, lockRelatedTarget, relatedDestination, relatedExplanation } from '../learning-support/related-item-selector.js';
import { untimedModes, type SupportStage } from '../learning-support/policies.js';

type Decision = MutationOutcome | ProductError;
const success = (body: unknown, status = 200): MutationOutcome => ({ status, body: toJson(body) });
const conflict = () => new ProductError('CONFLICT');

export function releasableExplanation(version: BankVersion) {
  return version.explanations.find(explanation => version.contentState === 'DEVELOPMENT' ||
    (explanation.reviewStatus === 'APPROVED' && explanation.publishedAt && explanation.publishedAt.getTime() <= Date.now()));
}

export function createSessionService(db: DatabaseClient, config: AppConfig) {
  /** The owner lock precedes session and idempotency reads on every mutation.
   * Request identity includes the operation and target, not merely the answer body.
   * Records are retained and honoured even after expiry; no cleanup workflow is enabled.
   */
  async function mutate(userId: string, key: string, operation: string, body: object,
    target: { sessionId: string; itemId?: string } | null,
    work: (tx: Transaction, session: StoredSession | null) => Promise<Decision>,
    guard?: (tx: Transaction, session: StoredSession | null) => Promise<void>,
  ): Promise<MutationOutcome> {
    const requestHash = mutationHash(operation, target, body);
    const outcome = await withOwnerTransaction(db, userId, async tx => {
      let session = target ? await lockSession(tx, userId, target.sessionId) : await lockActiveSession(tx, userId);
      if (target?.itemId && !session?.items.some(item => item.id === target.itemId)) throw new AccessError(404, 'NOT_FOUND');
      if (session) session = await expireSession(tx, session);
      if (guard) await guard(tx, session);
      // Application-level learner-wide uniqueness is protected by the owner lock,
      // in addition to the DB's narrower (user, operation, key) uniqueness guard.
      try {
        const replay = await readReplay(tx, userId, key, operation, requestHash);
        if (replay) return replay;
      } catch (error) {
        // A domain conflict is thrown outside the transaction so a newly
        // detected expiry/outbox event commits. Unexpected DB errors roll back.
        if (error instanceof ProductError && error.code === 'CONFLICT') return error;
        throw error;
      }
      const decision = await work(tx, session);
      if (decision instanceof ProductError) return decision;
      const sessionId = target?.sessionId ?? (typeof decision.body === 'object' && decision.body !== null && 'id' in decision.body ? String(decision.body.id) : null);
      await saveReplay(tx, userId, sessionId, key, operation, requestHash, decision);
      return decision;
    });
    // Domain refusals occur before writes (apart from a deliberately committed expiry).
    // Database exceptions escape the callback and roll back the entire mutation.
    if (outcome instanceof ProductError) throw outcome;
    return outcome;
  }

  async function selectBank(tx: Transaction, categoryId: CreateSessionInput['categoryId']): Promise<BankVersion[]> {
    const states: ('PUBLISHED' | 'DEVELOPMENT')[] = ['PUBLISHED'];
    if (isContentEligible('DEVELOPMENT', config)) states.push('DEVELOPMENT');
    const candidates = await tx.questionVersion.findMany({
      where: { question: { categoryId }, contentState: { in: states }, heldOutMock: false, lessons: { none: {} } },
      select: { id: true }, orderBy: { id: 'asc' },
    });
    const selected: BankVersion[] = [];
    for (const candidate of candidates) {
      if (selected.length === 10) break;
      // Lock immutable versions in ID order before reading their option/key snapshot.
      await tx.$queryRaw`SELECT "id" FROM "QuestionVersion" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const version = await tx.questionVersion.findUnique({ where: { id: candidate.id }, include: { ...versionInclude, lessons: { select: { id: true } } } });
      if (!version || !isContentEligible(version.contentState, config) || version.heldOutMock || version.lessons.length ||
          version.question.categoryId !== categoryId || !version.answerKey || !releasableExplanation(version)) continue;
      selected.push(version);
    }
    return selected;
  }

  return {
    create(userId: string, key: string, input: CreateSessionInput) {
      // LEARN/PRACTICE/REVIEW are untimed static-bank sessions with the same safe
      // answer/submit rules. Full Mock/Daily creation flows remain deferred.
      if (!['LEARN', 'PRACTICE', 'REVIEW'].includes(input.mode)) throw new AccessError(403, 'FORBIDDEN');
      return mutate(userId, key, 'session.create', input, null, async (tx, active) => {
        if (active && ['CREATED', 'IN_PROGRESS', 'SUBMITTED'].includes(active.state)) return conflict();
        const versions = await selectBank(tx, input.categoryId);
        if (!versions.length) return new ProductError('UNAVAILABLE');
        const session = await tx.practiceSession.create({ data: {
          userId, categoryId: input.categoryId, mode: input.mode, state: 'IN_PROGRESS', startedAt: new Date(),
          items: { create: versions.map((version, position) => ({
            questionVersionId: version.id, explanationVersionId: releasableExplanation(version)!.id,
            position, optionOrder: version.options.map(option => option.optionKey), solutionRelease: 'AFTER_ANSWER',
          })) },
        }, include: sessionInclude });
        const dto = serializeSession(session);
        await enqueueSessionEvent(tx, session.id, 'session.created');
        return success(dto, 201);
      });
    },

    hydrate(userId: string, id: string) {
      return withOwnerTransaction(db, userId, async tx => serializeSession(await expireSession(tx, await lockSession(tx, userId, id))));
    },

    active(userId: string) {
      return withOwnerTransaction(db, userId, async tx => {
        const found = await lockActiveSession(tx, userId);
        const session = found ? await expireSession(tx, found) : null;
        return { session: session && session.state !== 'EXPIRED' ? serializeSession(session) : null };
      });
    },

    answer(userId: string, id: string, itemId: string, key: string, input: CommitAnswerInput) {
      return mutate(userId, key, 'session.answer', input, { sessionId: id, itemId }, async (tx, session) => {
        if (!session || !['CREATED', 'IN_PROGRESS'].includes(session.state)) return conflict();
        const item = session.items.find(item => item.id === itemId)!;
        if (!item.optionOrder.includes(input.optionKey)) return new ProductError('INVALID_INPUT');
        if (item.response) {
          if (item.response.optionKey !== input.optionKey || (item.response.selfReportedReason ?? undefined) !== input.selfReportedReason) return conflict();
          return success(serializeItem(item));
        }
        const assistance = await assistanceAtCommit(tx, item.id);
        const committedAt = new Date();
        const gradedOnCommit = untimedModes.includes(session.mode);
        const answerKey = item.questionVersion.answerKey;
        if (!answerKey || answerKey.scoringVersion !== session.scoringVersion || session.scoringVersion !== 'option-v1') throw new Error('Invalid private scoring version');
        const scored = scoreOption({ options: item.questionVersion.options.map(o => ({ key: o.optionKey, text: o.text })), correctOptionKey: answerKey.optionKey }, input.optionKey);
        await tx.response.create({ data: {
          sessionItemId: item.id, questionVersionId: item.questionVersionId, optionKey: input.optionKey,
          submittedAt: committedAt, ...assistance,
          correct: gradedOnCommit ? scored.correct : null, scoringVersion: gradedOnCommit ? session.scoringVersion : null,
          ...(input.selfReportedReason === undefined ? {} : { selfReportedReason: input.selfReportedReason }),
        } });
        if (gradedOnCommit) await recordRetrieval(tx, userId, item, scored.correct, committedAt, assistance.assistanceLevel);
        if (session.state === 'CREATED') await tx.practiceSession.update({ where: { id }, data: { state: 'IN_PROGRESS', startedAt: new Date() } });
        await enqueueSessionEvent(tx, id, 'session.answer-committed', item.id, { sessionItemId: item.id });
        const updated = await tx.practiceSession.findUniqueOrThrow({ where: { id }, include: sessionInclude });
        return success(serializeItem(updated.items.find(candidate => candidate.id === itemId)!));
      });
    },

    submit(userId: string, id: string, key: string) {
      return mutate(userId, key, 'session.submit', {}, { sessionId: id }, async (tx, session) => {
        if (!session) return conflict();
        if (session.state === 'SCORED' && session.result) return success(serializeResult(session.result));
        if (!['CREATED', 'IN_PROGRESS'].includes(session.state) || !session.items.length || session.items.some(item => !item.response)) return conflict();
        let correct = 0, independentAttempts = 0, independentCorrect = 0;
        for (const item of session.items) {
          const answerKey = item.questionVersion.answerKey;
          if (!answerKey || answerKey.scoringVersion !== session.scoringVersion || session.scoringVersion !== 'option-v1') throw new Error('Invalid private scoring version');
          const scored = scoreOption({
            options: item.questionVersion.options.map(option => ({ key: option.optionKey, text: option.text })),
            correctOptionKey: answerKey.optionKey,
          }, item.response!.optionKey);
          correct += Number(scored.correct);
          if (item.response!.assistanceLevel === 'INDEPENDENT') {
            independentAttempts++;
            independentCorrect += Number(scored.correct);
          }
          // Untimed first commits already recorded this retrieval. Assessment
          // responses (and ungraded historical Task 4 commits) enter once here.
          if (item.response!.correct === null) await recordRetrieval(tx, userId, item, scored.correct, item.response!.submittedAt, item.response!.assistanceLevel);
          await tx.response.update({ where: { sessionItemId: item.id }, data: { correct: scored.correct, scoringVersion: session.scoringVersion } });
        }
        const now = new Date();
        const result = await tx.sessionResult.create({ data: {
          sessionId: id, total: session.items.length, correct, independentAttempts, independentCorrect,
          assistedAttempts: session.items.length - independentAttempts, scoringVersion: session.scoringVersion,
          summary: { policyVersion: 'static-practice-v1' }, scoredAt: now,
        } });
        await tx.practiceSession.update({ where: { id }, data: { state: 'SCORED', submittedAt: now, scoredAt: now } });
        await enqueueSessionEvent(tx, id, 'session.scored');
        return success(serializeResult(result));
      });
    },

    startRelated(userId: string, id: string, itemId: string, key: string, questionVersionId: string) {
      let candidate: BankVersion;
      let assistanceStage: SupportStage;
      const guard = async (tx: Transaction, session: StoredSession | null) => {
        if (!session) throw new AccessError(404, 'NOT_FOUND');
        const item = session.items.find(i => i.id === itemId)!;
        const context: SupportContext = { session, item, version: item.questionVersion };
        assistanceStage = authorizeSupport({ userId }, session, item, 'RELATED_PRACTICE').assistanceStage;
        assertHistoricalContext(context, config);
        candidate = await lockRelatedTarget(tx, context, config, questionVersionId);
      };
      return mutate(userId, key, 'session.related', { questionVersionId }, { sessionId: id, itemId }, async (tx, session) => {
        if (!session) return conflict();
        const active = await activeRelatedSession(tx, userId);
        const destination = relatedDestination(session, active, questionVersionId);
        if (destination.kind === 'UNAVAILABLE') return conflict();
        const itemData = { questionVersionId, explanationVersionId: relatedExplanation(candidate, config)!.id,
          optionOrder: candidate.options.map(o => o.optionKey), solutionRelease: 'AFTER_ANSWER' as const };
        let targetSession: StoredSession;
        let targetItemId: string;
        let status = 200;
        if (destination.kind === 'CREATE') {
          targetSession = await tx.practiceSession.create({ data: { userId, categoryId: session.categoryId,
            mode: 'PRACTICE', state: 'IN_PROGRESS', startedAt: new Date(), items: { create: { ...itemData, position: 0 } },
          }, include: sessionInclude });
          targetItemId = targetSession.items[0]!.id;
          status = 201;
          await enqueueSessionEvent(tx, targetSession.id, 'session.created');
        } else {
          // Owner lock is already held. Lock the destination session before
          // reading or inserting its immutable selected item, even on resume.
          targetSession = await lockSession(tx, userId, destination.session.id);
          if (destination.kind === 'RESUME') targetItemId = destination.itemId;
          else {
            const position = Math.max(-1, ...targetSession.items.map(i => i.position)) + 1;
            targetSession = await tx.practiceSession.update({ where: { id: targetSession.id },
              data: { items: { create: { ...itemData, position } } }, include: sessionInclude });
            targetItemId = targetSession.items.find(i => i.questionVersionId === questionVersionId)!.id;
          }
        }
        const targetItem = targetSession.items.find(i => i.id === targetItemId)!;
        if (targetItem.response) return conflict();
        await tx.learningSupportEvent.create({ data: { userId, sessionItemId: itemId,
          questionVersionId: session.items.find(i => i.id === itemId)!.questionVersionId,
          action: 'RELATED_PRACTICE', assistanceStage } });
        return success({ sessionId: targetSession.id, sessionItemId: targetItemId, item: serializeItem(targetItem) }, status);
      }, guard);
    },

    abandon(userId: string, id: string, key: string) {
      return mutate(userId, key, 'session.abandon', {}, { sessionId: id }, async (tx, session) => {
        if (!session) return conflict();
        if (session.state === 'ABANDONED') return success(serializeSession(session));
        if (!['CREATED', 'IN_PROGRESS'].includes(session.state)) return conflict();
        const abandoned = await tx.practiceSession.update({ where: { id }, data: { state: 'ABANDONED' }, include: sessionInclude });
        await enqueueSessionEvent(tx, id, 'session.abandoned');
        return success(serializeSession(abandoned));
      });
    },

    async results(userId: string, id: string) {
      const result = await withOwnerTransaction(db, userId, async tx => {
        const session = await expireSession(tx, await lockSession(tx, userId, id));
        return session.state === 'SCORED' && session.result ? serializeResult(session.result) : conflict();
      });
      if (result instanceof ProductError) throw result;
      return result;
    },
  };
}
