import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/support/test-database.js';

// e2e tests need the disposable test Postgres:
//   docker compose -f docker-compose.yml -f docker-compose.test.yml up -d postgres-test
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
    },
    // Suites share one database; run files one at a time.
    fileParallelism: false,
  },
});
