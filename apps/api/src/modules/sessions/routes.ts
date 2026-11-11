import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ActiveSessionDto, CommitAnswerInput, CreateSessionInput, EmptySessionMutationInput,
  OpaqueId, PublicSessionItem, SessionDto, SessionResultDto,
} from '@reasoningapp/contracts';
import type { AppDependencies } from '../../app.js';
import { parseInput, ProductError } from '../../errors.js';
import { requireLearner } from '../auth/authorization.js';
import { createSessionService } from './service.js';

export function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key)) throw new ProductError('INVALID_INPUT');
  return key;
}

export function registerSessionRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const service = createSessionService(deps.db, deps.config);
  async function learner(request: FastifyRequest) {
    const { userId } = await requireLearner(request);
    await app.requirePracticeAccess(userId);
    return userId;
  }
  app.post('/v1/sessions', async (request, reply) => {
    const userId = await learner(request);
    const input = parseInput(CreateSessionInput, request.body);
    const outcome = await service.create(userId, idempotencyKey(request), input);
    return reply.header('cache-control', 'no-store').code(outcome.status).send(SessionDto.parse(outcome.body));
  });
  app.get('/v1/sessions/active', async (request, reply) => {
    const userId = await learner(request);
    return reply.header('cache-control', 'no-store').send(ActiveSessionDto.parse(await service.active(userId)));
  });
  app.get<{ Params: { id: string } }>('/v1/sessions/:id', async (request, reply) => {
    const userId = await learner(request);
    return reply.header('cache-control', 'no-store').send(SessionDto.parse(await service.hydrate(userId, parseInput(OpaqueId, request.params.id))));
  });
  app.post<{ Params: { id: string; itemId: string } }>('/v1/sessions/:id/items/:itemId/answer', async (request, reply) => {
    const userId = await learner(request);
    const id = parseInput(OpaqueId, request.params.id), itemId = parseInput(OpaqueId, request.params.itemId);
    const input = parseInput(CommitAnswerInput, request.body);
    const outcome = await service.answer(userId, id, itemId, idempotencyKey(request), input);
    return reply.header('cache-control', 'no-store').code(outcome.status).send(PublicSessionItem.parse(outcome.body));
  });
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/submit', async (request, reply) => {
    const userId = await learner(request);
    const id = parseInput(OpaqueId, request.params.id);
    parseInput(EmptySessionMutationInput, request.body);
    const outcome = await service.submit(userId, id, idempotencyKey(request));
    return reply.header('cache-control', 'no-store').code(outcome.status).send(SessionResultDto.parse(outcome.body));
  });
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/abandon', async (request, reply) => {
    const userId = await learner(request);
    const id = parseInput(OpaqueId, request.params.id);
    parseInput(EmptySessionMutationInput, request.body);
    const outcome = await service.abandon(userId, id, idempotencyKey(request));
    return reply.header('cache-control', 'no-store').code(outcome.status).send(SessionDto.parse(outcome.body));
  });
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/results', async (request, reply) => {
    const userId = await learner(request);
    return reply.header('cache-control', 'no-store').send(SessionResultDto.parse(await service.results(userId, parseInput(OpaqueId, request.params.id))));
  });
}
