import { defineConfig } from 'prisma/config';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Prisma 7 config owns the datasource URL. Inherited env wins over the local file.
try { loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx src/seed-cli.ts' },
  // Optional during pure schema validation/generation; migrations require it.
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
