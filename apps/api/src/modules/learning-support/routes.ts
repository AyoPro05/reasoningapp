import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  EmptySessionMutationInput, FeedbackDto, HintDto, OpaqueId, QuestionReportDto, QuestionReportInput,
  RelatedPracticeDto, RelatedPracticeInput, RelatedPracticeTargetDto, TutorInput,
} from '@reasoningapp/contracts';
import type { AppDependencies } from '../../app.js';
import { parseInput } from '../../errors.js';
import { requireLearner } from '../auth/authorization.js';
import { idempotencyKey } from '../sessions/routes.js';
import { createSessionService } from '../sessions/service.js';
import { createLearningSummaryService } from '../personalization/learning-summary.js';
import { createProgressService } from '../personalization/progress.js';
import { createSupportService } from './hint-service.js';
import { createRelatedSelector } from './related-item-selector.js';

export function registerLearningSupportRoutes(app: FastifyInstance, deps: AppDependencies) {
  const support = createSupportService(deps.db, deps.config);
  const related = createRelatedSelector(deps.db, deps.config);
  const sessions = createSessionService(deps.db, deps.config);
  const progress = createProgressService(deps.db);
  const summary = createLearningSummaryService(deps.db);
  async function learner(request: FastifyRequest) {
    const { userId } = await requireLearner(request);
    await app.requirePracticeAccess(userId);
    return userId;
  }
  const base = '/v1/sessions/:id/items/:itemId';
  type ItemParams = { Params: { id: string; itemId: string } };
  function ids(request: FastifyRequest<ItemParams>) {
    return { sessionId: parseInput(OpaqueId, request.params.id), itemId: parseInput(OpaqueId, request.params.itemId) };
  }
  app.post<ItemParams>(`${base}/hints`, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const userId = await learner(request), { sessionId, itemId } = ids(request);
    parseInput(EmptySessionMutationInput, request.body);
    const outcome = await support.hint(userId, sessionId, itemId, idempotencyKey(request));
    return reply.code(outcome.status).send(HintDto.parse(outcome.body));
  });
  app.post<ItemParams>(`${base}/explanation`, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const userId = await learner(request), { sessionId, itemId } = ids(request);
    parseInput(EmptySessionMutationInput, request.body);
    const outcome = await support.explanation(userId, sessionId, itemId, idempotencyKey(request));
    return reply.code(outcome.status).send(FeedbackDto.parse(outcome.body));
  });
  app.post<ItemParams>(`${base}/tutor`, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const userId = await learner(request), { sessionId, itemId } = ids(request);
    const input = parseInput(TutorInput, request.body);
    idempotencyKey(request);
    return support.tutor(userId, sessionId, itemId, input.action);
  });
  app.get<ItemParams>(`${base}/related-practice`, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const userId = await learner(request), { sessionId, itemId } = ids(request);
    return RelatedPracticeDto.parse(await related.select(userId, sessionId, itemId));
  });
  app.post<ItemParams>(`${base}/related-practice`, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const userId = await learner(request), { sessionId, itemId } = ids(request);
    const input = parseInput(RelatedPracticeInput, request.body);
    const outcome = await sessions.startRelated(userId, sessionId, itemId, idempotencyKey(request), input.questionVersionId);
    return reply.code(outcome.status).send(RelatedPracticeTargetDto.parse(outcome.body));
  });
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/learning-summary', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const userId = await learner(request);
    return summary.getLearningSummary(parseInput(OpaqueId, request.params.id), userId);
  });
  app.get('/v1/progress', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    return progress.getProgress(await learner(request));
  });
  app.post('/v1/question-reports', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const userId = await learner(request);
    const input = parseInput(QuestionReportInput, request.body);
    const outcome = await support.report(userId, idempotencyKey(request), input);
    return reply.code(outcome.status).send(QuestionReportDto.parse(outcome.body));
  });
}
