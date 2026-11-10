import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (migrate, generate, studio).
 *
 * The CLI connects through DIRECT_URL (Supabase session pooler or direct
 * connection), because migrations need a session-level connection. The
 * running app uses DATABASE_URL (transaction pooler) instead; see
 * src/prisma/prisma.service.ts.
 *
 * `prisma generate` needs no database, so DIRECT_URL may be unset when
 * building the image.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? '',
  },
});
