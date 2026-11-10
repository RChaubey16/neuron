import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

async function createApp(
  override?: Partial<PrismaService>,
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (override) {
    builder = builder.overrideProvider(PrismaService).useValue(override);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

describe('Health (e2e)', () => {
  describe('with the test database', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /api/v1/health reports ok', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'ok',
        checks: { app: { status: 'up' }, database: { status: 'up' } },
      });
      expect(typeof res.body.checks.database.latencyMs).toBe('number');
    });

    it('GET /api/v1/health/live reports ok', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200, { status: 'ok' });
    });

    it('serves Swagger UI and the OpenAPI document', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/docs')
        .expect(200)
        .expect('Content-Type', /html/);

      const spec = await request(app.getHttpServer())
        .get('/api/v1/openapi.json')
        .expect(200);
      expect(spec.body.info.title).toBe('Neuron API');
      expect(Object.keys(spec.body.paths)).toEqual(
        expect.arrayContaining(['/api/v1/health', '/api/v1/health/live']),
      );
    });
  });

  describe('when the database is down', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createApp({
        ping: async () => false,
        onModuleInit: async () => undefined,
        onModuleDestroy: async () => undefined,
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /api/v1/health returns 503 with details', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(503);

      expect(res.body).toMatchObject({
        status: 'error',
        checks: { app: { status: 'up' }, database: { status: 'down' } },
      });
    });

    it('GET /api/v1/health/live still returns 200', async () => {
      await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    });
  });
});
