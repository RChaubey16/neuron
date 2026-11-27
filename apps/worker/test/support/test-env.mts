import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Environment for the worker tests. They use their own database and Redis
 * database, because Turborepo runs the API and worker tests at the same time.
 */
export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://neuron:neuron@localhost:5432/neuron_worker_test';
export const TEST_REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/2';

// Mailpit's ports can be changed in the repo-root .env (e.g. when 8025 is taken).
const rootEnvPath = resolve(import.meta.dirname, '../../../../.env');
const rootEnv = existsSync(rootEnvPath) ? parseEnv(readFileSync(rootEnvPath, 'utf8')) : {};
export const MAILPIT_SMTP_PORT = rootEnv['MAILPIT_SMTP_PORT'] ?? '1025';
export const MAILPIT_API_URL = `http://localhost:${rootEnv['MAILPIT_UI_PORT'] ?? '8025'}`;

export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'localhost',
  SMTP_PORT: MAILPIT_SMTP_PORT,
  SMTP_SECURE: 'false',
  WORKER_CONCURRENCY: '2',
};
