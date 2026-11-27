import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { TEST_DATABASE_URL } from './test-env.mjs';

/**
 * Runs once before the API tests: creates the test database if it doesn't
 * exist and applies every migration, so tests run against the real schema.
 * Needs the Docker Compose Postgres running (`pnpm infra:up`).
 */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const databaseName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Unexpected test database name: ${databaseName}`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });

  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Can't reach Postgres for the API tests at ${url.host}. Start it with \`pnpm infra:up\`.\n${String(error)}`,
    );
  }

  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.end();
  }

  const dbPackage = resolve(__dirname, '../../../../packages/db');
  execFileSync(resolve(dbPackage, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
