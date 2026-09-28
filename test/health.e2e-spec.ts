import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { PRODUCER_REDIS } from './../src/redis/redis.module';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET) returns ok status', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/health (GET) is not rate-limited by the global throttler', async () => {
    // Global default is 20 requests/60s — health checks (liveness probes,
    // uptime monitors) must stay exempt so they're never mistaken for abuse.
    for (let i = 0; i < 25; i++) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  });

  // CI has no Postgres or Redis, so both probes are stubbed on the real
  // instances the app resolved; the timeout/failure handling itself is
  // covered by health.service.spec.ts.
  const stubDependencies = () => ({
    database: jest
      .spyOn(app.get(PrismaService), '$queryRaw')
      .mockResolvedValue([{ '?column?': 1 }]),
    redis: jest
      .spyOn(app.get(PRODUCER_REDIS), 'ping')
      .mockResolvedValue('PONG'),
  });

  it('/health/ready (GET) returns 200 when Postgres and Redis respond', () => {
    stubDependencies();
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('/health/ready (GET) returns 503 with the failing check when a dependency is down', async () => {
    stubDependencies().database.mockRejectedValue(
      new Error('connection refused'),
    );

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503)
      .expect({ status: 'error', checks: { database: 'down', redis: 'up' } });
  });
});
