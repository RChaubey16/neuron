import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { TEST_WEB_URL } from './support/test-env.mjs';

describe('API basics (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('GET /health returns ok when the database answers', async () => {
    const response = await request(t.app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', checks: { database: 'up' } });
  });

  it('GET /health returns 503 when the database is down', async () => {
    vi.spyOn(t.prisma, 'ping').mockRejectedValueOnce(new Error('connection refused'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await request(t.app.getHttpServer()).get('/health').expect(503);

    expect(response.body).toEqual({ status: 'error', checks: { database: 'down' } });
  });

  it('does not reveal the framework in headers', async () => {
    const response = await request(t.app.getHttpServer()).get('/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const response = await request(t.app.getHttpServer()).get('/does-not-exist').expect(404);

    expect(response.body).toMatchObject({ statusCode: 404 });
  });

  it('allows the dashboard origin to call the API with credentials', async () => {
    const response = await request(t.app.getHttpServer())
      .options('/api-keys')
      .set('Origin', TEST_WEB_URL)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBe(TEST_WEB_URL);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow other origins', async () => {
    const response = await request(t.app.getHttpServer())
      .options('/api-keys')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    // The allowed origin is fixed, so it's always the dashboard's. A browser on
    // another site sees a mismatch and blocks the request.
    expect(response.headers['access-control-allow-origin']).toBe(TEST_WEB_URL);
    expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
  });
});
