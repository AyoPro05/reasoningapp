import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api/src/app.js';
import { seedVerifiedDevelopmentUser } from '../../apps/api/src/modules/auth/development-seed.js';
import { enqueueAuthMail } from '../../apps/api/src/modules/auth/mail.js';
import { deliverOutbox } from '../../apps/worker/src/outbox.js';
import { RecordingMailProvider, cookieHeader, task3Database } from '../helpers/task3.js';

const { db, config, runId } = task3Database();
const mailProvider = new RecordingMailProvider();
const password = 'Synthetic-local-passphrase-359!';
const emails = new Set<string>();
const apps: FastifyInstance[] = [];
let app: FastifyInstance;
let nextAddress = 0;
let connected = false;

beforeAll(async () => {
  await db.$queryRaw`SELECT 1`;
  connected = true;
  app = await buildApp({ db, config, mailProvider });
  apps.push(app);
});
afterAll(async () => {
  try {
    for (const instance of apps) await instance.close();
    if (!connected) return;
    const users = await db.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true } });
    const ids = users.map(user => user.id);
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await db.entitlement.deleteMany({ where: { userId: { in: ids } } });
    await db.verification.deleteMany({ where: { OR: [{ value: { in: ids } }, { identifier: { in: [...emails] } }] } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  } finally { await db.$disconnect(); }
});

function address() {
  const email = `${runId}-${++nextAddress}@example.invalid`;
  emails.add(email);
  return email;
}
function post(path: string, payload: object, cookie?: string, instance = app) {
  return instance.inject({ method: 'POST', url: `/api/auth/${path}`, remoteAddress: `192.0.2.${nextAddress % 200 + 1}`, headers: {
    origin: config.webOrigin, ...(cookie ? { cookie } : {}),
  }, payload });
}
async function register(email = address(), instance = app) {
  const response = await post('sign-up/email', { email, password, name: 'Synthetic learner' }, undefined, instance);
  expect(response.statusCode).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { email, userId: user.id, response };
}
async function drain(userId: string) {
  const rows = await db.outboxEvent.findMany({ where: { aggregateId: userId, type: 'auth.mail', status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
  for (const row of rows) await deliverOutbox({ db, mailProvider }, row.id);
}
async function verify(userId: string, email: string, instance = app) {
  await drain(userId);
  const message = [...mailProvider.deliveries.values()].find(mail => mail.recipient === email && mail.templateKey === 'auth.verifyEmail');
  expect(Boolean(message?.url)).toBe(true);
  const url = new URL(message!.url!);
  expect(url.origin).toBe(config.authUrl);
  const response = await instance.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
  expect([200, 302]).toContain(response.statusCode);
  expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(true);
}
async function learner() {
  const user = await register();
  await verify(user.userId, user.email);
  const login = await post('sign-in/email', { email: user.email, password });
  expect(login.statusCode).toBe(200);
  return { ...user, login, cookie: cookieHeader(login) };
}

// Removing the adapter/model mapping, verification policy or password hashing breaks this flow.
test('registers real credentials, persists verification mail and denies unverified sign-in', async () => {
  const { email, userId, response } = await register();
  expect(response.json().token).toBeNull();
  expect(await db.authSession.count({ where: { userId } })).toBe(0);
  const account = await db.account.findFirstOrThrow({ where: { userId, providerId: 'credential' } });
  expect(Boolean(account.password && account.password !== password)).toBe(true);
  expect(await db.outboxEvent.count({ where: { aggregateId: userId, type: 'auth.mail' } })).toBe(1);
  expect((await post('sign-in/email', { email, password })).statusCode).toBe(403);
  await verify(userId, email);
  expect((await post('sign-in/email', { email, password: 'Incorrect-passphrase-359!' })).statusCode).toBe(401);
  const login = await post('sign-in/email', { email, password });
  expect(login.statusCode).toBe(200);
  expect(await db.authSession.count({ where: { userId } })).toBe(1);
  expect(await db.practiceSession.count({ where: { userId } })).toBe(0);
  expect((await app.inject({ url: '/v1/me', headers: { cookie: cookieHeader(login) } })).json()).toEqual({ userId });
});

test('preserves separate HttpOnly SameSite cookies and clears the database session on sign-out', async () => {
  const { userId, cookie, login } = await learner();
  const cookies = login.headers['set-cookie'];
  expect(Array.isArray(cookies)).toBe(true);
  const tokenCookie = (Array.isArray(cookies) ? cookies : []).find(value => value.includes('session_token='));
  expect(Boolean(tokenCookie?.includes('HttpOnly'))).toBe(true);
  expect(Boolean(tokenCookie?.toLowerCase().includes('samesite=lax'))).toBe(true);
  const response = await post('sign-out', {}, cookie);
  expect(response.statusCode).toBe(200);
  expect(await db.authSession.count({ where: { userId } })).toBe(0);
  expect((await app.inject({ url: '/v1/me', headers: { cookie } })).statusCode).toBe(401);
});

test('authoritative session lookup rejects revoked, expired and newly unverified sessions', async () => {
  const first = await learner();
  expect((await app.inject({ url: '/v1/me', headers: { cookie: first.cookie } })).statusCode).toBe(200);
  await db.authSession.deleteMany({ where: { userId: first.userId } });
  expect((await app.inject({ url: '/v1/me', headers: { cookie: first.cookie } })).statusCode).toBe(401);
  const second = await learner();
  await db.authSession.updateMany({ where: { userId: second.userId }, data: { expiresAt: new Date(0) } });
  expect((await app.inject({ url: '/v1/me', headers: { cookie: second.cookie } })).statusCode).toBe(401);
  const third = await learner();
  await db.user.update({ where: { id: third.userId }, data: { emailVerified: false } });
  expect((await app.inject({ url: '/v1/me', headers: { cookie: third.cookie } })).statusCode).toBe(403);
});

test('identity headers cannot authenticate or impersonate another learner', async () => {
  const owner = await learner();
  const other = await learner();
  expect((await app.inject({ url: '/v1/me', headers: { 'x-user-id': other.userId, authorization: `Bearer ${other.userId}` } })).statusCode).toBe(401);
  const response = await app.inject({ url: `/v1/me?userId=${other.userId}`, headers: { cookie: owner.cookie, 'x-user-id': other.userId } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ userId: owner.userId });
  const victim = await db.authSession.findFirstOrThrow({ where: { userId: other.userId } });
  // Better Auth deliberately returns success for foreign/nonexistent session tokens.
  expect((await post('revoke-session', { token: victim.token }, owner.cookie)).statusCode).toBe(200);
  expect((await app.inject({ url: '/v1/me', headers: { cookie: other.cookie } })).statusCode).toBe(200);
  expect((await post('revoke-session', { token: victim.token }, other.cookie)).statusCode).toBe(200);
  expect((await app.inject({ url: '/v1/me', headers: { cookie: other.cookie } })).statusCode).toBe(401);
});

test.each(['https://attacker.invalid', 'null', 'exp://192.0.2.1:8081', 'reasoningapp://attacker'])('blocks unconfigured origin %s before creating identity', async origin => {
  const email = address();
  const response = await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { origin }, payload: { email, password, name: 'Blocked' } });
  expect(response.statusCode).toBe(403);
  expect(await db.user.count({ where: { email } })).toBe(0);
});

test('blocks cookie CSRF, untrusted redirects and Expo-origin spoofing while accepting the configured native scheme', async () => {
  const owner = await learner();
  const csrf = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: owner.cookie }, payload: {} });
  expect(csrf.statusCode).toBe(403);
  expect((await app.inject({ url: '/v1/me', headers: { cookie: owner.cookie } })).statusCode).toBe(200);
  expect((await post('request-password-reset', { email: owner.email, redirectTo: 'https://attacker.invalid/reset' })).statusCode).toBe(403);
  const blocked = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { 'expo-origin': 'https://attacker.invalid' }, payload: { email: owner.email, password } });
  expect(blocked.statusCode).toBe(403);
  const native = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { 'expo-origin': config.mobileOrigin }, payload: { email: owner.email, password } });
  expect(native.statusCode).toBe(200);
  expect(cookieHeader(native).length > 0).toBe(true);
});

test('rejects first-login browser CSRF with missing Origin and cross-site navigation metadata', async () => {
  const email = address();
  const response = await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: {
    'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document',
  }, payload: { email, password, name: 'Blocked browser form' } });
  expect(response.statusCode).toBe(403);
  expect(await db.user.count({ where: { email } })).toBe(0);
});

test('uses configured auth base URL rather than request Host for verification links', async () => {
  const email = address();
  const response = await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { origin: config.webOrigin, host: 'attacker.invalid', 'x-forwarded-host': 'attacker.invalid' }, payload: { email, password, name: 'Synthetic learner' } });
  expect(response.statusCode).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await verify(user.id, email);
});

test('recovery changes the maintained password hash, consumes the token and revokes all prior sessions', async () => {
  const owner = await learner();
  expect((await post('request-password-reset', { email: owner.email, redirectTo: `${config.webOrigin}/reset-password` })).statusCode).toBe(200);
  await drain(owner.userId);
  const message = [...mailProvider.deliveries.values()].find(mail => mail.recipient === owner.email && mail.templateKey === 'auth.resetPassword');
  expect(Boolean(message?.url)).toBe(true);
  const resetUrl = new URL(message!.url!);
  expect(resetUrl.origin).toBe(config.authUrl);
  const token = resetUrl.pathname.split('/').at(-1)!;
  const newPassword = 'New-synthetic-local-passphrase-746!';
  expect((await post('reset-password', { token, newPassword })).statusCode).toBe(200);
  expect((await app.inject({ url: '/v1/me', headers: { cookie: owner.cookie } })).statusCode).toBe(401);
  expect((await post('sign-in/email', { email: owner.email, password })).statusCode).toBe(401);
  expect((await post('sign-in/email', { email: owner.email, password: newPassword })).statusCode).toBe(200);
  expect((await post('reset-password', { token, newPassword: password })).statusCode).toBe(400);
});

test('expired recovery tokens cannot change credentials', async () => {
  const owner = await learner();
  await post('request-password-reset', { email: owner.email });
  const verification = await db.verification.findFirstOrThrow({ where: { value: owner.userId, identifier: { startsWith: 'reset-password:' } } });
  await db.verification.update({ where: { id: verification.id }, data: { expiresAt: new Date(0) } });
  expect((await post('reset-password', { token: verification.identifier.slice('reset-password:'.length), newPassword: 'Another-synthetic-passphrase-476!' })).statusCode).toBe(400);
  expect((await post('sign-in/email', { email: owner.email, password })).statusCode).toBe(200);
});

test('entitlement belongs to the authenticated learner and is rechecked on every request', async () => {
  const owner = await learner();
  const other = await learner();
  const check = (cookie: string) => app.inject({ url: '/v1/practice-access', headers: { cookie } });
  expect((await check(owner.cookie)).statusCode).toBe(403);
  const entitlement = await db.entitlement.create({ data: { userId: owner.userId, key: 'practice', source: 'task3-test', status: 'ACTIVE', startsAt: new Date(Date.now() - 60_000) } });
  expect((await check(owner.cookie)).statusCode).toBe(200);
  expect((await app.inject({ url: `/v1/practice-access?userId=${owner.userId}`, headers: { cookie: other.cookie, 'x-user-id': owner.userId } })).statusCode).toBe(403);
  for (const data of [
    { status: 'REVOKED' as const }, { status: 'EXPIRED' as const },
    { status: 'ACTIVE' as const, expiresAt: new Date(0) },
    { status: 'ACTIVE' as const, expiresAt: null, startsAt: new Date(Date.now() + 60_000) },
    { status: 'ACTIVE' as const, startsAt: new Date(0), revokedAt: new Date() },
  ]) {
    await db.entitlement.update({ where: { id: entitlement.id }, data });
    expect((await check(owner.cookie)).statusCode).toBe(403);
  }
});

test('development verified seeding is explicit, idempotent and unavailable in production', async () => {
  const email = address();
  const input = { email, password, name: 'Synthetic development learner' };
  await expect(seedVerifiedDevelopmentUser(db, { ...config, seedVerifiedUsers: false }, input)).rejects.toThrow();
  const enabled = { ...config, developmentFixturesEnabled: true, seedVerifiedUsers: true };
  await expect(seedVerifiedDevelopmentUser(db, { ...enabled, environment: 'production' }, input)).rejects.toThrow();
  expect(await db.user.count({ where: { email } })).toBe(0);
  const user = await seedVerifiedDevelopmentUser(db, enabled, input);
  const repeated = await seedVerifiedDevelopmentUser(db, enabled, input);
  expect(repeated.userId).toBe(user.userId);
  expect(await db.account.count({ where: { userId: user.userId, providerId: 'credential' } })).toBe(1);
  const login = await post('sign-in/email', { email, password });
  expect(login.statusCode).toBe(200);
  expect((await app.inject({ url: '/v1/practice-access', headers: { cookie: cookieHeader(login) } })).statusCode).toBe(200);
});

test('verification outbox persistence failure is recoverable by resend without a duplicate identity', async () => {
  let fail = true;
  let logs = '';
  const isolated = await buildApp({ db, config, mailProvider, logStream: { write(line: string) { logs += line; } }, enqueueMail: async (message) => {
    if (message.templateKey === 'auth.verifyEmail' && fail) { fail = false; throw new Error('Synthetic persistence outage'); }
    return enqueueAuthMail(db, message);
  } });
  apps.push(isolated);
  const email = address();
  const initial = await post('sign-up/email', { email, password, name: 'Recoverable learner' }, undefined, isolated);
  // Better Auth 1.7.18 awaits but swallows this signup callback error. Account
  // creation success is not a mail receipt; the application's durable marker is.
  expect(initial.statusCode).toBe(200);
  expect(initial.json().token).toBeNull();
  expect(initial.json().mailDelivered).toBeUndefined();
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.emailVerified).toBe(false);
  expect(await db.authSession.count({ where: { userId: user.id } })).toBe(0);
  expect(await db.account.count({ where: { userId: user.id, providerId: 'credential' } })).toBe(1);
  expect(await db.verification.count({ where: { identifier: email } })).toBe(0); // email verification is a maintained signed JWT
  expect(await db.outboxEvent.count({ where: { aggregateId: user.id, type: 'auth.mail' } })).toBe(0);
  const failedEnqueue = await db.outboxEvent.findFirstOrThrow({ where: { aggregateId: user.id, type: 'auth.mail.enqueue-failed' } });
  expect(failedEnqueue.status).toBe('FAILED');
  expect(failedEnqueue.payload).toEqual({ templateKey: 'auth.verifyEmail', code: 'MAIL_ENQUEUE_FAILED' });
  expect([...mailProvider.deliveries.values()].filter(message => message.recipient === email)).toHaveLength(0);
  expect(logs.includes('AUTH_MAIL_ENQUEUE_FAILED')).toBe(true);
  expect(logs.includes(password) || logs.includes(config.authSecret) || logs.includes(email) || logs.includes('token=')).toBe(false);
  expect((await post('send-verification-email', { email }, undefined, isolated)).statusCode).toBe(200);
  await verify(user.id, email, isolated);
  expect(await db.user.count({ where: { email } })).toBe(1);
  expect(await db.account.count({ where: { userId: user.id, providerId: 'credential' } })).toBe(1);
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: failedEnqueue.id } })).status).toBe('SUCCEEDED');
  expect((await post('sign-in/email', { email, password }, undefined, isolated)).statusCode).toBe(200);
});

test('welcome enqueue failure after verification recovers at next verified sign-in, once only', async () => {
  let fail = true;
  const isolated = await buildApp({ db, config, mailProvider, enqueueMail: async message => {
    if (message.templateKey === 'auth.welcome' && fail) { fail = false; throw new Error('Synthetic persistence outage'); }
    return enqueueAuthMail(db, message);
  } });
  apps.push(isolated);
  const owner = await register(address(), isolated);
  await drain(owner.userId);
  const message = [...mailProvider.deliveries.values()].find(mail => mail.recipient === owner.email && mail.templateKey === 'auth.verifyEmail')!;
  const url = new URL(message.url!);
  expect((await isolated.inject({ url: `${url.pathname}${url.search}` })).statusCode).toBe(500);
  expect((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).emailVerified).toBe(true);
  for (let i = 0; i < 2; i++) expect((await post('sign-in/email', { email: owner.email, password }, undefined, isolated)).statusCode).toBe(200);
  expect(await db.outboxEvent.count({ where: { aggregateId: owner.userId, dedupeKey: `auth-welcome-${owner.userId}` } })).toBe(1);
});

test('body size and request rate limits are enforced at the Fastify boundary', async () => {
  const large = await post('sign-up/email', { email: address(), password, name: 'x'.repeat(40_000) });
  expect(large.statusCode).toBe(413);
  const isolated = await buildApp({ db, config, mailProvider });
  apps.push(isolated);
  const responses = [];
  for (let i = 0; i < 61; i++) responses.push(await isolated.inject({ url: '/v1/me', remoteAddress: '192.0.2.42' }));
  expect(responses.at(-1)!.statusCode).toBe(429);
});

test('unsupported Mailpit and real providers fail explicitly rather than fake-delivering', async () => {
  await expect(buildApp({ db, config: { ...config, environment: 'development', mailProvider: 'mailpit', smtpUrl: 'smtp://localhost:1025' }, mailProvider })).rejects.toThrow(/Mailpit.*unavailable/i);
});
