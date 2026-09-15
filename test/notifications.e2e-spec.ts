import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { EmailProcessor } from './../src/notifications/processors/email.processor';

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  const prismaMock = {
    apiKey: { findFirst: jest.fn(), update: jest.fn() },
    usageLog: { create: jest.fn() },
    emailJob: {
      create: jest.fn(),
      findFirst: jest.fn(),
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
});
