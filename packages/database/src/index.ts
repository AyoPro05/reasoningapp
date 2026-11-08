// Server-only exports. Import fixtures/seed explicitly; never bundle into a client.
export { createDatabaseClient } from './client.js';
export type { DatabaseClient, Prisma } from './client.js';
export { updateQuestionDraft } from './content-writes.js';
export { enqueueAuthMail, parseAuthMail } from './mail-outbox.js';
export type { AuthMail, MailDelivery, MailProvider, EnqueueAuthMail } from './mail-outbox.js';
