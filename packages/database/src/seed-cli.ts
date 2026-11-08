import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readConfig } from '@reasoningapp/config';
import { createDatabaseClient } from './client.js';
import { assertDevelopmentSeedAllowed } from './content-policy.js';
import { seedDevelopment } from './seed.js';

try { loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const config = readConfig(process.env);
assertDevelopmentSeedAllowed(config);
const db = createDatabaseClient(config.databaseUrl);
try {
  await seedDevelopment(db, config);
  console.log('Seeded 50 unreviewed DEVELOPMENT questions and five lessons. No review or publication was granted.');
} finally { await db.$disconnect(); }
