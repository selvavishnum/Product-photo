import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved the connection string out of schema.prisma.
 *
 * The CLI (migrate, introspect) reads it from here; the runtime client gets it
 * separately through a driver adapter in src/db/prisma.ts. Two paths to the
 * same URL, which is why both read the identical env var.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
