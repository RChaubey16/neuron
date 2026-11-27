import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TEST_HEALTH_PORT } from './support/test-env.mjs';
import { createTestWorker, FakeEmailProvider, type TestWorker } from './support/test-worker.js';
import { SendEmailProcessor } from '../src/messages/send-email.processor.js';

const HEALTH_URL = `http://localhost:${TEST_HEALTH_PORT}`;

/** The worker's health check, against the real test database and Redis. */
describe('Worker health check (e2e)', () => {
  let t: TestWorker;

  beforeAll(async () => {
    t = await createTestWorker(new FakeEmailProvider());
  });

  afterAll(async () => {
    await t.module.close();
  });

  it('answers 200 when Postgres, Redis and the worker are up', async () => {
    const response = await fetch(`${HEALTH_URL}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up', worker: 'up' },
    });
  });

  it('answers 404 for anything else', async () => {
    expect((await fetch(`${HEALTH_URL}/`)).status).toBe(404);
    expect((await fetch(`${HEALTH_URL}/health`, { method: 'POST' })).status).toBe(404);
  });

  it('answers 503 once the BullMQ worker has stopped', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await t.module.get(SendEmailProcessor).worker.close();

    const response = await fetch(`${HEALTH_URL}/health`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'up', worker: 'down' },
    });
  });
});
