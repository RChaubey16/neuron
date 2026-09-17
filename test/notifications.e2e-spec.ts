import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { EmailProcessor } from './../src/notifications/processors/email.processor';

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  const jwtServiceMock = { verifyAsync: jest.fn() };
  const dashboardUser = { id: 'user-1', email: 'user@example.com' };
  const prismaMock = {
    user: { findUniqueOrThrow: jest.fn() },
    apiKey: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    usageLog: { create: jest.fn() },
    emailJob: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const emailQueueMock = { add: jest.fn(), remove: jest.fn() };

  const baseJob = {
    id: 'job-1',
    apiKeyId: 'key-1',
    to: ['recipient@example.com'],
    subject: 'Test',
    body: '<p>Hello</p>',
    error: null,
    attemptsMade: 0,
    resendId: null,
    createdAt: new Date('2026-09-15T00:00:00Z'),
    updatedAt: new Date('2026-09-15T00:00:00Z'),
  };

  beforeEach(async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      revokedAt: null,
    });
    prismaMock.apiKey.update.mockResolvedValue({});
    prismaMock.usageLog.create.mockResolvedValue({});
    emailQueueMock.add.mockResolvedValue({});
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: dashboardUser.id,
      email: dashboardUser.email,
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(dashboardUser);

    // Overriding the 'email' queue token and EmailProcessor entirely
    // (not just their outputs) prevents Nest from ever constructing the
    // real BullMQ Queue/Worker — so this suite never opens a real Redis
    // connection, the same mocking philosophy this repo already applies
    // to PrismaService.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(getQueueToken('email'))
      .useValue(emailQueueMock)
      .overrideProvider(EmailProcessor)
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

  describe('POST /api/v1/notifications/email', () => {
    it('creates a durable EmailJob, queues it, and logs usage under email-notifications', async () => {
      prismaMock.emailJob.create.mockResolvedValue({
        ...baseJob,
        status: 'QUEUED',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/notifications/email')
        .set('x-api-key', 'nrn_validkeymaterial')
        .send({
          to: ['recipient@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        })
        .expect(202);

      expect(response.body).toMatchObject({ id: 'job-1', status: 'QUEUED' });
      expect(prismaMock.emailJob.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          apiKeyId: 'key-1',
          to: ['recipient@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        },
      });
      expect(emailQueueMock.add).toHaveBeenCalledWith(
        'send',
        {
          to: ['recipient@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        },
        expect.objectContaining({ jobId: 'job-1' }),
      );
      expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          apiKeyId: 'key-1',
          service: 'email-notifications',
          endpoint: '/api/v1/notifications/email',
        },
      });
    });

    it('rejects with no x-api-key header', () => {
      return request(app.getHttpServer())
        .post('/api/v1/notifications/email')
        .send({
          to: ['recipient@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        })
        .expect(401);
    });

    it('rejects an invalid payload with 400 and never creates or queues the job', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/notifications/email')
        .set('x-api-key', 'nrn_validkeymaterial')
        .send({ to: ['not-an-email'], subject: '', body: '' })
        .expect(400);

      expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
      expect(emailQueueMock.add).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/notifications/email/templates', () => {
    it('lists the available templates with their required variables', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications/email/templates')
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(200);

      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'welcome',
            requiredVariables: ['name', 'productName'],
          }),
        ]),
      );
    });
  });

  describe('POST /api/v1/notifications/email/templates/:templateKey/send', () => {
    it('renders the template and queues a durable EmailJob', async () => {
      prismaMock.emailJob.create.mockResolvedValue({
        ...baseJob,
        subject: 'Welcome to Neuron, Ada!',
        status: 'QUEUED',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/notifications/email/templates/welcome/send')
        .set('x-api-key', 'nrn_validkeymaterial')
        .send({
          to: ['recipient@example.com'],
          variables: { name: 'Ada', productName: 'Neuron' },
        })
        .expect(202);

      expect(response.body).toMatchObject({
        id: 'job-1',
        status: 'QUEUED',
        subject: 'Welcome to Neuron, Ada!',
      });
      expect(prismaMock.emailJob.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          apiKeyId: 'key-1',
          to: ['recipient@example.com'],
          subject: 'Welcome to Neuron, Ada!',
          body: "<p>Hi Ada,</p><p>Thanks for signing up for Neuron. We're glad to have you.</p>",
        },
      });
    });

    it('returns 404 for an unknown template key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/notifications/email/templates/does-not-exist/send')
        .set('x-api-key', 'nrn_validkeymaterial')
        .send({ to: ['recipient@example.com'], variables: {} })
        .expect(404);

      expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
    });

    it('returns 400 when required template variables are missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/notifications/email/templates/welcome/send')
        .set('x-api-key', 'nrn_validkeymaterial')
        .send({ to: ['recipient@example.com'], variables: { name: 'Ada' } })
        .expect(400);

      expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/notifications/email/:jobId', () => {
    const jobId = '33333333-3333-4333-8333-333333333333';

    it("returns the job's status when owned by the caller", async () => {
      prismaMock.emailJob.findFirst.mockResolvedValue({
        ...baseJob,
        id: jobId,
        status: 'SENT',
        resendId: 'resend-1',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/notifications/email/${jobId}`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(200);

      expect(response.body).toMatchObject({
        id: jobId,
        status: 'SENT',
        resendId: 'resend-1',
      });
      expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
        where: { id: jobId, apiKeyId: 'key-1' },
      });
    });

    it('returns 404 when the job is not owned by the caller', async () => {
      prismaMock.emailJob.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get(`/api/v1/notifications/email/${jobId}`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(404);
    });

    it('rejects a non-UUID jobId with 400, without querying the DB', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/notifications/email/not-a-uuid')
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(400);

      expect(prismaMock.emailJob.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/notifications/email/:jobId/retry', () => {
    const jobId = '11111111-1111-4111-8111-111111111111';

    it('re-queues a FAILED job', async () => {
      const failedJob = {
        ...baseJob,
        id: jobId,
        status: 'FAILED',
        error: 'boom',
      };
      prismaMock.emailJob.findFirst.mockResolvedValue(failedJob);
      prismaMock.emailJob.update.mockResolvedValue({
        ...failedJob,
        status: 'QUEUED',
        error: null,
      });
      emailQueueMock.remove.mockResolvedValue(1);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/notifications/email/${jobId}/retry`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(200);

      expect(response.body).toMatchObject({ status: 'QUEUED' });
      expect(emailQueueMock.add).toHaveBeenCalledWith(
        'send',
        expect.objectContaining({ subject: 'Test' }),
        expect.objectContaining({ jobId }),
      );
    });

    it('rejects with 409 when the job is not FAILED', async () => {
      prismaMock.emailJob.findFirst.mockResolvedValue({
        ...baseJob,
        id: jobId,
        status: 'SENT',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/notifications/email/${jobId}/retry`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(409);

      expect(emailQueueMock.add).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/v1/notifications/email/:jobId', () => {
    const jobId = '22222222-2222-4222-8222-222222222222';

    it('cancels a QUEUED job', async () => {
      prismaMock.emailJob.findFirst.mockResolvedValue({
        ...baseJob,
        id: jobId,
        status: 'QUEUED',
      });
      emailQueueMock.remove.mockResolvedValue(1);
      prismaMock.emailJob.updateMany.mockResolvedValue({ count: 1 });

      await request(app.getHttpServer())
        .delete(`/api/v1/notifications/email/${jobId}`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(204);

      expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith({
        where: { id: jobId, status: 'QUEUED' },
        data: { status: 'CANCELLED' },
      });
    });

    it('rejects with 409 when the job is no longer QUEUED', async () => {
      prismaMock.emailJob.findFirst.mockResolvedValue({
        ...baseJob,
        id: jobId,
        status: 'PROCESSING',
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/notifications/email/${jobId}`)
        .set('x-api-key', 'nrn_validkeymaterial')
        .expect(409);

      expect(emailQueueMock.remove).not.toHaveBeenCalled();
    });
  });

  describe('GET /notifications/email (dashboard)', () => {
    it("lists the caller's own email jobs via the dashboard route, not the ApiKeyGuard", async () => {
      const listedJob = { ...baseJob, status: 'SENT' };
      prismaMock.emailJob.findMany.mockResolvedValue([listedJob]);
      prismaMock.emailJob.count.mockResolvedValue(1);

      const response = await request(app.getHttpServer())
        .get('/notifications/email')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(prismaMock.emailJob.findMany).toHaveBeenCalledWith({
        where: { userId: dashboardUser.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      });
      expect(response.body).toMatchObject({
        items: [{ id: listedJob.id, status: listedJob.status }],
        total: 1,
        limit: 20,
        offset: 0,
      });
    });

    it('rejects with no Authorization header', () => {
      return request(app.getHttpServer())
        .get('/notifications/email')
        .expect(401);
    });
  });

  describe('POST /notifications/email (dashboard)', () => {
    it("queues an email from the dashboard using the caller's userId directly, with no ApiKey lookup at all", async () => {
      prismaMock.emailJob.create.mockResolvedValue({
        ...baseJob,
        status: 'QUEUED',
      });

      const response = await request(app.getHttpServer())
        .post('/notifications/email')
        .set('Authorization', 'Bearer valid-token')
        .send({
          to: ['recipient@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        })
        .expect(202);

      expect(response.body).toMatchObject({ id: baseJob.id, status: 'QUEUED' });
      expect(prismaMock.apiKey.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
      expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
        data: {
          userId: dashboardUser.id,
          apiKeyId: null,
          service: 'email-notifications',
          endpoint: '/notifications/email',
        },
      });
    });

    it('rejects with no Authorization header, without touching the DB', async () => {
      await request(app.getHttpServer())
        .post('/notifications/email')
        .send({
          to: ['recipient@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        })
        .expect(401);

      expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /notifications/email/:jobId/retry (dashboard)', () => {
    const jobId = '44444444-4444-4444-8444-444444444444';

    it("re-queues a FAILED job owned by any of the caller's own API keys", async () => {
      const failedJob = {
        ...baseJob,
        id: jobId,
        status: 'FAILED',
        error: 'boom',
      };
      prismaMock.emailJob.findFirst.mockResolvedValue(failedJob);
      prismaMock.emailJob.update.mockResolvedValue({
        ...failedJob,
        status: 'QUEUED',
        error: null,
      });
      emailQueueMock.remove.mockResolvedValue(1);

      const response = await request(app.getHttpServer())
        .post(`/notifications/email/${jobId}/retry`)
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
        where: { id: jobId, userId: dashboardUser.id },
      });
      expect(response.body).toMatchObject({ status: 'QUEUED' });
      expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
        data: {
          userId: dashboardUser.id,
          apiKeyId: null,
          service: 'email-notifications',
          endpoint: '/notifications/email/:jobId/retry',
        },
      });
    });

    it('rejects with no Authorization header, without touching the DB', async () => {
      await request(app.getHttpServer())
        .post(`/notifications/email/${jobId}/retry`)
        .expect(401);

      expect(prismaMock.emailJob.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /notifications/email/:jobId (dashboard)', () => {
    const jobId = '55555555-5555-4555-8555-555555555555';

    it("cancels a QUEUED job owned by any of the caller's own API keys", async () => {
      prismaMock.emailJob.findFirst.mockResolvedValue({
        ...baseJob,
        id: jobId,
        status: 'QUEUED',
      });
      emailQueueMock.remove.mockResolvedValue(1);
      prismaMock.emailJob.updateMany.mockResolvedValue({ count: 1 });

      await request(app.getHttpServer())
        .delete(`/notifications/email/${jobId}`)
        .set('Authorization', 'Bearer valid-token')
        .expect(204);

      expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
        where: { id: jobId, userId: dashboardUser.id },
      });
      expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith({
        where: { id: jobId, status: 'QUEUED' },
        data: { status: 'CANCELLED' },
      });
      expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
        data: {
          userId: dashboardUser.id,
          apiKeyId: null,
          service: 'email-notifications',
          endpoint: '/notifications/email/:jobId',
        },
      });
    });

    it('rejects with no Authorization header, without touching the DB', async () => {
      await request(app.getHttpServer())
        .delete(`/notifications/email/${jobId}`)
        .expect(401);

      expect(prismaMock.emailJob.findFirst).not.toHaveBeenCalled();
    });
  });
});
