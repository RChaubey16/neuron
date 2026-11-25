import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export { Prisma, PrismaClient } from './generated/prisma/client.js';
export type { ApiKey, Message, User } from './generated/prisma/client.js';
export { MessageStatus } from './generated/prisma/enums.js';

/** How long to wait for a database connection before failing. */
const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * The node-postgres driver adapter, which Prisma 7 requires for SQL databases.
 * node-postgres waits forever for a connection by default, so a timeout is set:
 * an unreachable database then fails requests and health checks instead of hanging them.
 */
export function createPrismaAdapter(databaseUrl: string): PrismaPg {
  return new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
}
