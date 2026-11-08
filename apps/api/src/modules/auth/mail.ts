import type { AppConfig } from '@reasoningapp/config';
import type { MailDelivery, MailProvider } from '@reasoningapp/database';
export { enqueueAuthMail } from '@reasoningapp/database';

export function assertLocalMail(config: AppConfig, provider: MailProvider): void {
  if (config.mailProvider === 'mailpit') throw new Error('Mailpit transport unavailable in Task 3; configure MAIL_PROVIDER=fake');
  if (config.mailProvider !== 'fake' || provider.kind !== 'fake') throw new Error('Only the fake mail provider is available');
}

/** Local-only sink. Its receipt map survives retries in this process, not restarts.
 * No network, SMTP, real recipients or provider API is ever invoked. */
export function createFakeMailProvider(): MailProvider {
  const receipts = new Map<string, MailDelivery>();
  return { kind: 'fake', async send(message) {
    if (!receipts.has(message.deliveryId)) receipts.set(message.deliveryId, structuredClone(message));
  } };
}
