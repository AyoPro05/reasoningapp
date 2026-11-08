import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { expo } from '@better-auth/expo';
import type { AppConfig } from '@reasoningapp/config';
import { enqueueAuthMail, type AuthMail, type DatabaseClient, type EnqueueAuthMail } from '@reasoningapp/database';
import { clientIpHeader } from './transport.js';

export function createAuth(deps: { db: DatabaseClient; config: AppConfig; enqueueMail?: EnqueueAuthMail; onMailFailure?: (code: string) => void }) {
  const { db, config } = deps;
  if (config.skipEmailVerification) throw new Error('Email verification bypass is unavailable in Task 3');
  const writer = deps.enqueueMail ?? (message => enqueueAuthMail(db, message));
  const enqueue = async (message: AuthMail) => {
    const failureKey = `auth-enqueue-failed-${message.templateKey}-${message.userId}`;
    let receipt: { id: string };
    try { receipt = await writer(message); }
    catch {
      // Signup/reset callbacks can be swallowed by the maintained library. Keep
      // an explicit diagnostic without copying the private URL or exception.
      deps.onMailFailure?.('AUTH_MAIL_ENQUEUE_FAILED');
      try {
        await db.outboxEvent.upsert({ where: { dedupeKey: failureKey },
          create: { type: 'auth.mail.enqueue-failed', aggregateId: message.userId, dedupeKey: failureKey,
            status: 'FAILED', attempts: 1, payload: { templateKey: message.templateKey, code: 'MAIL_ENQUEUE_FAILED' } },
          update: { status: 'FAILED', processedAt: null, attempts: { increment: 1 } },
        });
      } catch { deps.onMailFailure?.('AUTH_MAIL_FAILURE_MARKER_UNAVAILABLE'); }
      throw new Error('Authentication mail enqueue unavailable');
    }
    try {
      // This marker describes enqueue recovery, not delivery. The actual mail
      // row remains PENDING until the worker persists its delivery receipt.
      await db.outboxEvent.updateMany({ where: { dedupeKey: failureKey, status: 'FAILED' }, data: { status: 'SUCCEEDED', processedAt: new Date() } });
    } catch { deps.onMailFailure?.('AUTH_MAIL_FAILURE_MARKER_UNAVAILABLE'); }
    return receipt;
  };
  const welcome = (user: { id: string; email: string }) => enqueue({ userId: user.id, recipient: user.email, templateKey: 'auth.welcome' });
  const secure = new URL(config.authUrl).protocol === 'https:';
  return betterAuth({
    appName: 'ReasoningApp', baseURL: config.authUrl, basePath: '/api/auth', secret: config.authSecret,
    // Callback outbox writes use the root client. Do not pretend they join the
    // library's transaction. Explicit sequential mode allows failed-mail resend.
    database: prismaAdapter(db, { provider: 'postgresql', transaction: false }),
    trustedOrigins: [...config.trustedOrigins],
    plugins: [expo()],
    logger: { disabled: true },
    advanced: {
      disableOriginCheck: false, disableCSRFCheck: false, trustedProxyHeaders: false,
      ipAddress: { ipAddressHeaders: [clientIpHeader] },
      useSecureCookies: secure, cookiePrefix: 'reasoningapp',
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: 'lax', path: '/' },
    },
    session: { modelName: 'authSession', cookieCache: { enabled: false } },
    // Fastify also limits all routes; retain library endpoint limits explicitly in tests.
    rateLimit: { enabled: true, window: 60, max: 60 },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, autoSignIn: false,
      minPasswordLength: 12, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await enqueue({ userId: user.id, recipient: user.email, templateKey: 'auth.resetPassword', url });
      },
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await enqueue({ userId: user.id, recipient: user.email, templateKey: 'auth.verifyEmail', url });
      },
      afterEmailVerification: async user => { await welcome(user); },
    },
    databaseHooks: { session: { create: { after: async session => {
      const user = await db.user.findUnique({ where: { id: session.userId }, select: { id: true, email: true, emailVerified: true } });
      if (user?.emailVerified) await welcome(user);
    } } } },
  });
}
export type AppAuth = ReturnType<typeof createAuth>;
