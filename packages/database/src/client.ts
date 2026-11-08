import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

/** One factory; the caller owns lifecycle and must call $disconnect on shutdown. */
export function createDatabaseClient(databaseUrl: string): PrismaClient {
  const target = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('A PostgreSQL datasource is required');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
export type { Prisma } from './generated/prisma/client.js';
