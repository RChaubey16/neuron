import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { EmailProcessor } from './../src/notifications/email.processor';

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  const prismaMock = {
    apiKey: { findFirst: jest.fn(), update: jest.fn() },
    usageLog: { create: jest.fn() },
  };
  const emailQueueMock = { add: jest.fn() };

  beforeEach(async () => {
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

  it('queues an email for an authenticated caller and logs usage under email-notifications', async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      revokedAt: null,
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

    expect(response.body).toEqual({ queued: true });
    expect(emailQueueMock.add).toHaveBeenCalledWith(
      'send',
      { to: ['recipient@example.com'], subject: 'Test', body: '<p>Hello</p>' },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
    expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'key-1',
        service: 'email-notifications',
        endpoint: '/api/v1/notifications/email',
      },
    });
  });

  it('rejects POST /api/v1/notifications/email with no x-api-key header', () => {
    return request(app.getHttpServer())
      .post('/api/v1/notifications/email')
      .send({
        to: ['recipient@example.com'],
        subject: 'Test',
        body: '<p>Hello</p>',
      })
      .expect(401);
  });

  it('rejects an invalid payload with 400 and never queues the job', async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      revokedAt: null,
    });

    await request(app.getHttpServer())
      .post('/api/v1/notifications/email')
      .set('x-api-key', 'nrn_validkeymaterial')
      .send({ to: ['not-an-email'], subject: '', body: '' })
      .expect(400);

    expect(emailQueueMock.add).not.toHaveBeenCalled();
  });
});
