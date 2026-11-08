import { readConfig } from '@reasoningapp/config';
import { createDatabaseClient } from '@reasoningapp/database';
import { buildApp } from './app.js';

const config = readConfig(process.env);
const db = createDatabaseClient(config.databaseUrl);
try {
  const app = await buildApp({ db, config });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await db.$disconnect();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close().catch(() => { process.exitCode = 1; }); });
  const address = new URL(config.authUrl);
  await app.listen({ port: Number(address.port || (address.protocol === 'https:' ? 443 : 80)), host: address.hostname });
} catch {
  // Never dump Prisma/config/Request errors containing credentials or private URLs.
  process.stderr.write('API unavailable; check validated configuration and local dependencies.\n');
  await db.$disconnect();
  process.exitCode = 1;
}
