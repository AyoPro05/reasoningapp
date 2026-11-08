import { createHash } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { AppConfig } from '@reasoningapp/config';
import type { DatabaseClient } from '@reasoningapp/database';

/** Explicit local fixture identity. No implicit verification of existing accounts. */
export async function seedVerifiedDevelopmentUser(db: DatabaseClient, config: AppConfig, input: { email: string; name: string; password: string }): Promise<{ userId: string }> {
  if (!['development', 'test'].includes(config.environment) || !config.seedVerifiedUsers || !config.developmentFixturesEnabled) {
    throw new Error('Verified development seeding requires explicit local flags; production is forbidden');
  }
  const email = input.email.trim().toLowerCase();
  if (!email.endsWith('@example.invalid') || input.password.length < 12 || input.password.length > 128) throw new Error('Invalid synthetic development identity');
  const userId = `dev-${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
  const password = await hashPassword(input.password);
  await db.$transaction(async tx => {
    // Serialize concurrent seed calls without altering unrelated identities.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 3))`;
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing && (existing.id !== userId || !existing.emailVerified)) throw new Error('Development identity conflicts with an existing account');
    await tx.user.upsert({ where: { email }, update: {}, create: { id: userId, email, name: input.name, emailVerified: true } });
    await tx.account.upsert({ where: { providerId_accountId: { providerId: 'credential', accountId: userId } }, update: {},
      create: { providerId: 'credential', accountId: userId, userId, password } });
    await tx.entitlement.upsert({ where: { userId_key_source: { userId, key: 'practice', source: 'development-seed' } }, update: {},
      create: { userId, key: 'practice', source: 'development-seed', status: 'ACTIVE' } });
  });
  return { userId };
}
