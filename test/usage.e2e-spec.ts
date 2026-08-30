import {
  Controller,
  Get,
  INestApplication,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { jwtVerify } from 'jose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { ApiKeyGuard } from './../src/api-keys/guards/api-key.guard';
import { UsageLoggingInterceptor } from './../src/usage/interceptors/usage-logging.interceptor';
import { Service } from './../src/usage/decorators/service.decorator';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

// Proves UsageLoggingInterceptor works end-to-end without adding an unused
// production route — real service routes start consuming it from Phase 5
// onward, the same way test/api-keys.e2e-spec.ts exercises ApiKeyGuard.
@Controller('test-service')
class TestServiceController {
  @Get()
  @Service('test-service')
  @UseGuards(ApiKeyGuard)
  @UseInterceptors(UsageLoggingInterceptor)
  ping() {
    return { ok: true };
  }
}

describe('Usage (e2e)', () => {
  let app: INestApplication<App>;
  const mockJwtVerify = jwtVerify as jest.Mock;
  const user = { id: 'user-1', email: 'user@example.com' };
  const prismaMock = {
    user: { upsert: jest.fn() },
    apiKey: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    usageLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: user.id, email: user.email },
    });
    prismaMock.user.upsert.mockResolvedValue(user);
    prismaMock.apiKey.update.mockResolvedValue({});
    prismaMock.usageLog.create.mockResolvedValue({});

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestServiceController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('records a UsageLog row for an authenticated, @Service()-tagged call', async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: user.id,
      revokedAt: null,
    });

    await request(app.getHttpServer())
      .get('/test-service')
      .set('x-api-key', 'nrn_validkeymaterial')
      .expect(200)
      .expect({ ok: true });

    expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'key-1',
        service: 'test-service',
        endpoint: '/test-service',
      },
    });
  });

  it('does not record usage for a rejected (invalid key) request', async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/test-service')
      .set('x-api-key', 'nrn_unknownkey')
      .expect(401);

    expect(prismaMock.usageLog.create).not.toHaveBeenCalled();
  });

  it('GET /usage returns the aggregate for the logged-in user', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        service: 'test-service',
        date: new Date('2026-08-30T00:00:00Z'),
        apiKeyId: 'key-1',
        count: 1n,
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/usage')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(response.body).toEqual([
      {
        service: 'test-service',
        date: '2026-08-30',
        apiKeyId: 'key-1',
        count: 1,
      },
    ]);
  });

  it('rejects GET /usage with no bearer token', () => {
    return request(app.getHttpServer()).get('/usage').expect(401);
  });
});
