import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from '@reasoningapp/config';
import { ApiErrorDto, LearnerDto, PracticeAccessDto } from '@reasoningapp/contracts';
import type { DatabaseClient, MailProvider, EnqueueAuthMail } from '@reasoningapp/database';
import { createAuth, type AppAuth } from './modules/auth/auth.js';
import { AccessError, requireLearner } from './modules/auth/authorization.js';
import { assertLocalMail, createFakeMailProvider } from './modules/auth/mail.js';
import { createEntitlementService } from './modules/entitlements/service.js';
import { authHeaders } from './modules/auth/transport.js';

declare module 'fastify' {
  interface FastifyInstance {
    auth: AppAuth;
    requirePracticeAccess(userId: string): Promise<void>;
  }
}
export type AppDependencies = {
  db: DatabaseClient; config: AppConfig; mailProvider?: MailProvider; enqueueMail?: EnqueueAuthMail;
  logStream?: { write(message: string): void };
};

/** The caller owns injected database/provider lifecycle. No listener or worker starts here. */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const { db, config } = deps;
  assertLocalMail(config, deps.mailProvider ?? createFakeMailProvider());
  const app = Fastify({
    bodyLimit: 32_768, trustProxy: false, logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: 'info',
      ...(deps.logStream ? { stream: deps.logStream } : {}),
      redact: ['req.headers', 'req.body', 'req.url', 'res.headers', 'password', 'token', 'secret', 'url'],
      serializers: { req: request => ({ method: request.method }), res: response => ({ statusCode: response.statusCode }) },
    },
  });
  const auth = createAuth({ ...deps, onMailFailure: code => { app.log.error({ code }, 'Authentication mail enqueue unavailable'); } });
  app.decorate('auth', auth);
  app.decorate('requirePracticeAccess', createEntitlementService(db).requirePracticeAccess);
  const origins = new Set([config.authUrl, ...config.trustedOrigins]);
  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof AccessError ? error.statusCode :
      typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' && [400, 413, 429].includes(error.statusCode) ? error.statusCode : 500;
    const code = error instanceof AccessError ? error.code : status === 429 ? 'RATE_LIMITED' : status < 500 ? 'INVALID_INPUT' : 'INTERNAL_ERROR';
    if (status >= 500) app.log.error({ requestId: request.id }, 'Request failed');
    reply.code(status).send(ApiErrorDto.parse({ code, messageKey: `errors.${code}`, requestId: request.id }));
  });
  app.addHook('onRequest', async request => {
    const origin = request.headers.origin;
    const expoOrigin = request.headers['expo-origin'];
    // Library Expo adds exp:// in development; this exact boundary remains authoritative.
    if ((origin !== undefined && !origins.has(origin)) ||
        (expoOrigin !== undefined && (typeof expoOrigin !== 'string' || expoOrigin !== config.mobileOrigin))) throw new AccessError(403, 'FORBIDDEN');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !origin && !expoOrigin) throw new AccessError(403, 'FORBIDDEN');
    if (request.headers['sec-fetch-site'] === 'cross-site' && request.headers['sec-fetch-mode'] === 'navigate') throw new AccessError(403, 'FORBIDDEN');
  });
  await app.register(cors, { origin: [...origins].filter(origin => origin.startsWith('http')), credentials: true, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Idempotency-Key', 'expo-origin'] });
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });
  app.route({ method: ['GET', 'POST'], url: '/api/auth/*', async handler(request, reply) {
    // A malicious Host or forwarded Host must never affect links/redirects.
    const url = new URL(config.authUrl);
    const incoming = new URL(request.raw.url ?? '/', config.authUrl);
    url.pathname = incoming.pathname;
    url.search = incoming.search;
    const response = await auth.handler(new Request(url, {
      method: request.method, headers: authHeaders(request),
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
    }));
    response.headers.forEach((value, name) => { if (name !== 'set-cookie') reply.header(name, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    if (response.status >= 500) {
      app.log.error({ requestId: request.id }, 'Authentication request failed');
      return reply.code(500).send(ApiErrorDto.parse({ code: 'INTERNAL_ERROR', messageKey: 'errors.INTERNAL_ERROR', requestId: request.id }));
    }
    return reply.code(response.status).send(await response.text());
  } });
  app.get('/v1/me', async request => LearnerDto.parse(await requireLearner(request)));
  app.get('/v1/practice-access', async request => {
    const { userId } = await requireLearner(request);
    await app.requirePracticeAccess(userId);
    return PracticeAccessDto.parse({ allowed: true });
  });
  await app.ready();
  return app;
}
