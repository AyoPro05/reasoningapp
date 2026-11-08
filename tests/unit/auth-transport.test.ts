import { afterAll, beforeAll, expect, test } from 'vitest';
import { readConfig } from '@reasoningapp/config';
import { createDatabaseClient } from '@reasoningapp/database';
import { buildApp } from '../../apps/api/src/app.js';
import type { FastifyInstance } from 'fastify';

// Real Fastify + Better Auth. Invalid schema requests exercise the maintained
// limiter without opening a DB connection or replacing the authentication layer.
const config = readConfig({
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://local:synthetic@127.0.0.1:55432/reasoningapp_integration',
  REDIS_URL: 'redis://127.0.0.1:6379/15', AUTH_URL: 'http://localhost:3001', WEB_ORIGIN: 'http://localhost:3000',
  AUTH_SECRET: 'test-only-transport-secret-never-used-for-real-identities-123', MAIL_PROVIDER: 'fake',
});
const db = createDatabaseClient(config.databaseUrl);
let app: FastifyInstance;
beforeAll(async () => { app = await buildApp({ db, config }); });
afterAll(async () => { await app?.close(); await db.$disconnect(); });
function invalidLogin(remoteAddress: string, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url: '/api/auth/sign-in/email', remoteAddress,
    headers: { origin: config.webOrigin, ...headers }, payload: { email: 'invalid', password: 'synthetic-only' } });
}

test('Better Auth buckets use distinct trusted transport addresses rather than one shared fallback', async () => {
  for (let i = 0; i < 3; i++) expect((await invalidLogin('198.51.100.10')).statusCode).toBe(400);
  expect((await invalidLogin('198.51.100.10')).statusCode).toBe(429);
  expect((await invalidLogin('198.51.100.11')).statusCode).toBe(400);
});

test('client-supplied forwarding and internal IP headers cannot evade the maintained auth limiter', async () => {
  const send = (i: number) => invalidLogin('198.51.100.12', {
    'x-forwarded-for': `203.0.113.${i}`, 'x-real-ip': `203.0.113.${i}`,
    'x-reasoningapp-client-ip': `203.0.113.${i}`,
  });
  for (let i = 1; i <= 3; i++) expect((await send(i)).statusCode).toBe(400);
  expect((await send(4)).statusCode).toBe(429);
});

test('Fastify rate limits remain enabled independently of the auth endpoint rules', async () => {
  for (let i = 0; i < 60; i++) {
    expect((await app.inject({ url: '/v1/me', remoteAddress: '198.51.100.13' })).statusCode).toBe(401);
  }
  expect((await app.inject({ url: '/v1/me', remoteAddress: '198.51.100.13', headers: { 'x-forwarded-for': '203.0.113.55' } })).statusCode).toBe(429);
});
