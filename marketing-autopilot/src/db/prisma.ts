import { PrismaPg } from '@prisma/adapter-pg';

import { env, isProd } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * A single client for the process.
 *
 * Prisma 7 requires a driver adapter: the connection string is no longer read
 * from schema.prisma, so it is passed in here explicitly.
 *
 * Cached on globalThis so `tsx watch` hot-reloads do not open a new pool on
 * every file save and exhaust Postgres connections within minutes.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: isProd ? ['error'] : ['warn', 'error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (!isProd) globalForPrisma.prisma = prisma;
