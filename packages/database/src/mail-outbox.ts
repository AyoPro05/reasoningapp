import { createHash } from 'node:crypto';
import type { DatabaseClient, Prisma } from './client.js';

// Server-only event contract. Never export this through public client contracts.
export type AuthMail = {
  userId: string;
  recipient: string;
  templateKey: 'auth.verifyEmail' | 'auth.resetPassword' | 'auth.welcome';
  url?: string;
};
export type MailDelivery = Omit<AuthMail, 'userId'> & { deliveryId: string };
export interface MailProvider {
  readonly kind: 'fake';
  send(message: MailDelivery): Promise<void>;
}
export type EnqueueAuthMail = (message: AuthMail) => Promise<{ id: string }>;

export function parseAuthMail(userId: string, payload: unknown): AuthMail {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid mail event');
  const value = payload as Record<string, unknown>;
  if (!userId || typeof value.recipient !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.recipient) ||
      !['auth.verifyEmail', 'auth.resetPassword', 'auth.welcome'].includes(String(value.templateKey))) throw new Error('Invalid mail event');
  const templateKey = value.templateKey as AuthMail['templateKey'];
  if (templateKey === 'auth.welcome') {
    if (value.url !== undefined) throw new Error('Invalid mail event');
    return { userId, recipient: value.recipient, templateKey };
  }
  if (typeof value.url !== 'string') throw new Error('Invalid mail event');
  let url: URL;
  try { url = new URL(value.url); } catch { throw new Error('Invalid mail event'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid mail event');
  return { userId, recipient: value.recipient, templateKey, url: value.url };
}

/** With a caller's tx this insert shares its commit/rollback. A root client is
 * a separate callback write, never implicitly part of a Better Auth transaction. */
export async function enqueueAuthMail(db: DatabaseClient | Prisma.TransactionClient, input: AuthMail): Promise<{ id: string }> {
  const message = parseAuthMail(input.userId, input);
  const dedupeKey = message.templateKey === 'auth.welcome' ? `auth-welcome-${message.userId}` :
    `auth-${message.templateKey}-${createHash('sha256').update(`${message.userId}\n${message.url}`).digest('hex')}`;
  const { userId, ...payload } = message;
  return db.outboxEvent.upsert({
    where: { dedupeKey }, update: {},
    create: { type: 'auth.mail', aggregateId: userId, dedupeKey, payload },
    select: { id: true },
  });
}
