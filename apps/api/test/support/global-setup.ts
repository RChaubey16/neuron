import { execFileSync } from 'node:child_process';
import { assertNotSupabase, TEST_DATABASE_URL } from './test-database.js';

/**
 * Runs once before the e2e suite: applies all migrations to the disposable
 * test database, exactly as production does (`prisma migrate deploy`).
 */
export default function setup(): void {
  assertNotSupabase(TEST_DATABASE_URL);
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DIRECT_URL: TEST_DATABASE_URL },
  });
}
