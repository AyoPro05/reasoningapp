import { randomUUID } from 'node:crypto';
import { readConfig } from '@reasoningapp/config';
import { createDatabaseClient } from '@reasoningapp/database';
import { loadOptionalTestEnv } from './load-test-env.js';

/** Guard runs before opening a client. No resets, truncation or unrelated databases. */
export function task3Database() {
  loadOptionalTestEnv();
  const config = readConfig(process.env);
  const target = new URL(config.databaseUrl);
  if (config.environment !== 'test' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      target.port !== '55432' || target.pathname !== '/reasoningapp_integration') {
    throw new Error('Task 3 requires the explicit loopback:55432/reasoningapp_integration test database');
  }
  return { db: createDatabaseClient(config.databaseUrl), config, runId: `task3-${randomUUID()}` };
}

export type TestMail = {
  deliveryId: string;
  recipient: string;
  templateKey: 'auth.verifyEmail' | 'auth.resetPassword' | 'auth.welcome';
  url?: string;
};

/** External boundary only. Auth, Prisma, worker claims and persistence remain real. */
export class RecordingMailProvider {
  readonly kind = 'fake' as const;
  readonly deliveries = new Map<string, TestMail>();
  failBeforeSend = false;
  failAfterSend = false;
  async send(message: TestMail): Promise<void> {
    if (this.failBeforeSend) throw new Error('Synthetic delivery failure');
    if (!this.deliveries.has(message.deliveryId)) this.deliveries.set(message.deliveryId, structuredClone(message));
    if (this.failAfterSend) throw new Error('Synthetic acknowledgement loss');
  }
}

export function cookieHeader(response: { cookies: { name: string; value: string }[] }): string {
  return response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}
