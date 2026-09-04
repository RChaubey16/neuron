import {
  Controller,
  Get,
  INestApplication,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { ApiKeyGuard } from './../src/api-keys/guards/api-key.guard';

// Proves ApiKeyGuard works end-to-end without adding an unused production
// route — real service routes start consuming it from Phase 5 onward.
@Controller('test-service')
class TestServiceController {
  @Get()
  @UseGuards(ApiKeyGuard)
  ping() {
    return { ok: true };
  }
}

describe('ApiKeyController (e2e)', () => {
  let app: INestApplication<App>;
  const jwtServiceMock = { verifyAsync: jest.fn() };
  const user = { id: 'user-1', email: 'user@example.com' };
  const prismaMock = {
    user: { findUniqueOrThrow: jest.fn() },
    apiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: user.id,
      email: user.email,
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(user);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestServiceController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
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

  it('creates a key via the dashboard route, then authenticates a separate request using only that key', async () => {
    prismaMock.apiKey.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'key-1',
          createdAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
          ...data,
        }),
    );

    const createResponse = await request(app.getHttpServer())
      .post('/api-keys')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: 'CI key' })
      .expect(201);

    const createBody = createResponse.body as { key: string };
    const rawKey = createBody.key;
    expect(rawKey).toMatch(/^nrn_/);

    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: user.id,
      revokedAt: null,
    });
    prismaMock.apiKey.update.mockResolvedValue({});

    await request(app.getHttpServer())
      .get('/test-service')
      .set('x-api-key', rawKey)
      .expect(200)
      .expect({ ok: true });
  });

  it('lists keys without ever exposing the raw key or its hash', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue([
      {
        id: 'key-1',
        hashedKey: 'deadbeef',
        keyPrefix: 'nrn_abcd1234',
        name: 'CI key',
        createdAt: new Date('2026-08-29T00:00:00Z'),
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/api-keys')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(response.body).toEqual([
      {
        id: 'key-1',
        keyPrefix: 'nrn_abcd1234',
        name: 'CI key',
        createdAt: '2026-08-29T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
  });

  it('revokes a key, and a revoked key can no longer authenticate a service request', async () => {
    const keyId = '11111111-1111-4111-8111-111111111111';
    prismaMock.apiKey.findFirst.mockResolvedValueOnce({
      id: keyId,
      userId: user.id,
      revokedAt: null,
    });
    prismaMock.apiKey.update.mockResolvedValue({});

    await request(app.getHttpServer())
      .delete(`/api-keys/${keyId}`)
      .set('Authorization', 'Bearer valid-token')
      .expect(204);

    // Guard looks up with `revokedAt: null`, so a revoked key finds nothing.
    prismaMock.apiKey.findFirst.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .get('/test-service')
      .set('x-api-key', 'nrn_whateverkeywasrevoked')
      .expect(401);
  });

  it('rejects DELETE /api-keys/:id with a non-UUID id, without querying the DB', async () => {
    await request(app.getHttpServer())
      .delete('/api-keys/not-a-uuid')
      .set('Authorization', 'Bearer valid-token')
      .expect(400);

    expect(prismaMock.apiKey.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a service request with no x-api-key header', () => {
    return request(app.getHttpServer()).get('/test-service').expect(401);
  });
});
