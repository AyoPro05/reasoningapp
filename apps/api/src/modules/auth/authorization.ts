import type { FastifyRequest } from 'fastify';
import { authHeaders } from './transport.js';

export class AccessError extends Error {
  constructor(readonly statusCode: 401 | 403 | 404, readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND') {
    super(code);
  }
}

/** Identity comes only from a library-verified session, never request DTOs/headers. */
export async function requireLearner(request: FastifyRequest): Promise<{ userId: string }> {
  const session = await request.server.auth.api.getSession({
    headers: authHeaders(request), query: { disableCookieCache: true },
  });
  if (!session) throw new AccessError(401, 'UNAUTHENTICATED');
  if (!session.user.emailVerified) throw new AccessError(403, 'FORBIDDEN');
  return { userId: session.user.id };
}
