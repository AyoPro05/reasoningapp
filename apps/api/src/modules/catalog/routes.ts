import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CategoryId } from '@reasoningapp/contracts';
import type { AppDependencies } from '../../app.js';
import { parseInput } from '../../errors.js';
import { requireLearner } from '../auth/authorization.js';
import { createCatalogService } from './service.js';

export function registerCatalogRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const service = createCatalogService(deps.db, deps.config);
  async function learner(request: FastifyRequest) {
    const { userId } = await requireLearner(request);
    await app.requirePracticeAccess(userId);
  }
  app.get('/v1/categories', async (request, reply) => {
    await learner(request);
    return reply.header('cache-control', 'no-store').send(await service.categories());
  });
  app.get<{ Params: { categoryId: string } }>('/v1/lessons/:categoryId', async (request, reply) => {
    await learner(request);
    return reply.header('cache-control', 'no-store').send(await service.lessons(parseInput(CategoryId, request.params.categoryId)));
  });
}
