/**
 * Environment for the API tests. Vitest sets these before any test runs, and
 * they take precedence over the repo-root .env.
 */
export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://neuron:neuron@localhost:5432/neuron_test';

/** Redis database 1, so tests never touch the development queues in database 0. */
export const TEST_REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/1';
export const TEST_EMAIL_FROM = 'Neuron Test <noreply@neuron.test>';

export const TEST_WEB_URL = 'http://localhost:3000';
export const TEST_ALLOWED_EMAIL = 'allowed@example.com';
export const TEST_SESSION_SECRET = 'test-session-secret-that-is-long-enough-1234';

export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  EMAIL_FROM: TEST_EMAIL_FROM,
  WEB_URL: TEST_WEB_URL,
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
  SESSION_SECRET: TEST_SESSION_SECRET,
  ALLOWED_EMAILS: `${TEST_ALLOWED_EMAIL},second@example.com`,
};
