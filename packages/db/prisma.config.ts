import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env files itself. Locally, load the repo-root .env;
// in production (and in tests) DATABASE_URL is already set in the environment,
// and Node never overwrites variables that are already set.
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Optional so `prisma generate` works without a database; migrate commands
    // fail with a clear error if it is missing.
    url: process.env['DATABASE_URL'],
  },
});
