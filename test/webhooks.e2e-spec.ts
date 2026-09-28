import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { WEBHOOK_QUEUE } from './../src/webhooks/providers/webhook-queue.provider';
import { WebhookProcessor } from './../src/webhooks/processors/webhook.processor';

const ENDPOINT_ID = '6f1c2a4e-8b3d-4c5e-9f0a-1b2c3d4e5f60';
const DELIVERY_ID = '0a9b8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d';

describe('Webhooks (e2e)', () => {
  let app: INestApplication<App>;
  const jwtServiceMock = { verifyAsync: jest.fn() };
  const dashboardUser = { id: 'user-1', email: 'user@example.com' };
  const prismaMock = {
    user: { findUniqueOrThrow: jest.fn() },
    apiKey: { findFirst: jest.fn(), update: jest.fn() },
    usageLog: { create: jest.fn() },
    webhookEndpoint: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    webhookDelivery: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const webhookQueueMock = { addBulk: jest.fn(), remove: jest.fn() };

  const baseEndpoint = {
    id: ENDPOINT_ID,
    userId: 'user-1',
    url: 'https://example.com/hooks',
    description: null,
    events: ['email.sent'],
    secret: 'whsec_c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0',
    disabledAt: null,
    deletedAt: null,
    createdAt: new Date('2026-09-28T00:00:00Z'),
    updatedAt: new Date('2026-09-28T00:00:00Z'),
  };

  const baseDelivery = {
    id: DELIVERY_ID,
    endpointId: ENDPOINT_ID,
    userId: 'user-1',
    eventType: 'email.sent',
    payload: { type: 'email.sent' },
    status: 'FAILED',
    attemptsMade: 6,
    responseStatus: 500,
    error: 'Endpoint responded with HTTP 500',
    lastAttemptAt: new Date('2026-09-28T00:10:00Z'),
    createdAt: new Date('2026-09-28T00:00:00Z'),
    updatedAt: new Date('2026-09-28T00:10:00Z'),
  };

  beforeEach(async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      revokedAt: null,
    });
    prismaMock.apiKey.update.mockResolvedValue({});
    prismaMock.usageLog.create.mockResolvedValue({});
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(dashboardUser);
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: dashboardUser.id,
      email: dashboardUser.email,
    });
    prismaMock.webhookEndpoint.count.mockResolvedValue(0);
    prismaMock.webhookEndpoint.findFirst.mockResolvedValue(baseEndpoint);
    prismaMock.webhookDelivery.updateMany.mockResolvedValue({ count: 0 });
    webhookQueueMock.addBulk.mockResolvedValue([]);
    webhookQueueMock.remove.mockResolvedValue(1);

    // Overriding the queue token and the processor keeps Nest from
    // building the real webhook Queue/Worker for this suite.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(WEBHOOK_QUEUE)
      .useValue(webhookQueueMock)
      .overrideProvider(WebhookProcessor)
      .useValue({})
      .overrideProvider(JwtService)
      .useValue(jwtServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  describe('POST /api/v1/webhooks/endpoints', () => {
    it('creates an endpoint for the key owner, returns the secret once, and logs usage under webhooks', async () => {
      prismaMock.webhookEndpoint.create.mockImplementation(
        ({ data }: { data: object }) =>
          Promise.resolve({ ...baseEndpoint, ...data }),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/endpoints')
        .set('x-api-key', 'nrn_validkeymaterial')
        .send({ url: 'https://example.com/hooks', events: ['email.sent'] })
        .expect(201);

      expect(response.body).toMatchObject({
        id: ENDPOINT_ID,
        url: 'https://example.com/hooks',
        events: ['email.sent'],
        enabled: true,
      });
      expect(response.body).toMatchObject({
        secret: expect.stringMatching(/^whsec_/) as string,
      });
      expect(prismaMock.webhookEndpoint.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1' }) as object,
      });
      expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          apiKeyId: 'key-1',
          service: 'webhooks',
          endpoint: '/api/v1/webhooks/endpoints',
        },
      });
    });

    it('rejects with no x-api-key header', () => {
      return request(app.getHttpServer())
        .post('/api/v1/webhooks/endpoints')
        .send({ url: 'https://example.com/hooks', events: ['email.sent'] })
        .expect(401);
    });

    it('rejects an unknown event type', () => {
      return request(app.getHttpServer())
        .post('/api/v1/webhooks/endpoints')
        .set('x-api-key', 'nrn_validkeymaterial')
        .send({ url: 'https://example.com/hooks', events: ['email.opened'] })
        .expect(400);
    });

    it('rejects a private target', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/endpoints')
        .set('x-api-key', 'nrn_validkeymaterial')
        .send({ url: 'https://10.0.0.5/hooks', events: ['email.sent'] })
        .expect(400);

      expect(response.body).toMatchObject({
        message: 'URL must not point to a private or reserved address',
      });
      expect(prismaMock.webhookEndpoint.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /webhooks/endpoints (dashboard)', () => {
    it("lists the user's endpoints without their secrets", async () => {
      prismaMock.webhookEndpoint.findMany.mockResolvedValue([baseEndpoint]);

      const response = await request(app.getHttpServer())
        .get('/webhooks/endpoints')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      const body = response.body as Record<string, unknown>[];
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: ENDPOINT_ID });
      expect(body[0]).not.toHaveProperty('secret');
      expect(prismaMock.webhookEndpoint.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('rejects with no Authorization header', () => {
      return request(app.getHttpServer())
        .get('/webhooks/endpoints')
        .expect(401);
    });
  });

  describe('PATCH /webhooks/endpoints/:endpointId (dashboard)', () => {
    it('disables an endpoint', async () => {
      prismaMock.webhookEndpoint.update.mockResolvedValue({
        ...baseEndpoint,
        disabledAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .patch(`/webhooks/endpoints/${ENDPOINT_ID}`)
        .set('Authorization', 'Bearer valid-token')
        .send({ enabled: false })
        .expect(200);

      expect(response.body).toMatchObject({ enabled: false });
    });

    it('rejects a non-UUID endpoint id', () => {
      return request(app.getHttpServer())
        .patch('/webhooks/endpoints/not-a-uuid')
        .set('Authorization', 'Bearer valid-token')
        .send({ enabled: false })
        .expect(400);
    });
  });

  describe('DELETE /api/v1/webhooks/endpoints/:endpointId', () => {
    it('soft-deletes and returns 204', async () => {
      prismaMock.webhookEndpoint.update.mockResolvedValue(baseEndpoint);

      await request(app.getHttpServer())
        .delete(`/api/v1/webhooks/endpoints/${ENDPOINT_ID}`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(204);

      expect(prismaMock.webhookEndpoint.update).toHaveBeenCalledWith({
        where: { id: ENDPOINT_ID },
        data: { deletedAt: expect.any(Date) as Date },
      });
    });

    it('404s for an endpoint the caller does not own', async () => {
      prismaMock.webhookEndpoint.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .delete(`/api/v1/webhooks/endpoints/${ENDPOINT_ID}`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(404);
    });
  });

  describe('POST /webhooks/endpoints/:endpointId/test (dashboard)', () => {
    it('queues a webhook.test delivery and returns 202', async () => {
      prismaMock.webhookDelivery.create.mockImplementation(
        ({ data }: { data: object }) =>
          Promise.resolve({ ...baseDelivery, status: 'PENDING', ...data }),
      );

      const response = await request(app.getHttpServer())
        .post(`/webhooks/endpoints/${ENDPOINT_ID}/test`)
        .set('Authorization', 'Bearer valid-token')
        .expect(202);

      expect(response.body).toMatchObject({
        eventType: 'webhook.test',
        status: 'PENDING',
      });
      expect(webhookQueueMock.addBulk).toHaveBeenCalled();
    });

    it('returns 503 when the queue is unavailable', async () => {
      prismaMock.webhookDelivery.create.mockResolvedValue({
        ...baseDelivery,
        status: 'PENDING',
      });
      webhookQueueMock.addBulk.mockRejectedValue(
        new Error('Connection is closed'),
      );

      await request(app.getHttpServer())
        .post(`/webhooks/endpoints/${ENDPOINT_ID}/test`)
        .set('Authorization', 'Bearer valid-token')
        .expect(503);
    });
  });

  describe('deliveries', () => {
    it('GET /api/v1/webhooks/deliveries paginates the owner’s deliveries', async () => {
      prismaMock.webhookDelivery.findMany.mockResolvedValue([baseDelivery]);
      prismaMock.webhookDelivery.count.mockResolvedValue(1);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/webhooks/deliveries?endpointId=${ENDPOINT_ID}&limit=5`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(200);

      expect(response.body).toMatchObject({ total: 1, limit: 5, offset: 0 });
      expect(prismaMock.webhookDelivery.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', endpointId: ENDPOINT_ID },
        orderBy: { createdAt: 'desc' },
        take: 5,
        skip: 0,
      });
    });

    it('POST /webhooks/deliveries/:deliveryId/retry re-queues a failed delivery', async () => {
      prismaMock.webhookDelivery.findFirst.mockResolvedValue({
        ...baseDelivery,
        endpoint: baseEndpoint,
      });
      prismaMock.webhookDelivery.update.mockResolvedValue({
        ...baseDelivery,
        status: 'PENDING',
        attemptsMade: 0,
        error: null,
      });

      const response = await request(app.getHttpServer())
        .post(`/webhooks/deliveries/${DELIVERY_ID}/retry`)
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body).toMatchObject({ status: 'PENDING' });
      expect(webhookQueueMock.remove).toHaveBeenCalledWith(DELIVERY_ID);
      expect(webhookQueueMock.addBulk).toHaveBeenCalled();
    });

    it('retrying a delivery that is not FAILED returns 409', async () => {
      prismaMock.webhookDelivery.findFirst.mockResolvedValue({
        ...baseDelivery,
        status: 'SUCCEEDED',
        endpoint: baseEndpoint,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/webhooks/deliveries/${DELIVERY_ID}/retry`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(409);
    });
  });
});
