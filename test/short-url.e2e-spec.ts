import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('ShortUrl (e2e)', () => {
  let app: INestApplication<App>;
  const jwtServiceMock = { verifyAsync: jest.fn() };
  const dashboardUser = { id: 'user-1', email: 'user@example.com' };
  const prismaMock = {
    user: { findUniqueOrThrow: jest.fn() },
    apiKey: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    usageLog: { create: jest.fn() },
    shortUrl: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    prismaMock.apiKey.update.mockResolvedValue({});
    prismaMock.usageLog.create.mockResolvedValue({});
    prismaMock.shortUrl.update.mockResolvedValue({});
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: dashboardUser.id,
      email: dashboardUser.email,
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(dashboardUser);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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

  it('shortens a URL for an authenticated caller and logs usage under url-shortener', async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      revokedAt: null,
    });
    prismaMock.shortUrl.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'short-1',
          createdAt: new Date('2026-08-30T00:00:00Z'),
          clickCount: 0,
          ...data,
        }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/short-url/shorten')
      .set('x-api-key', 'nrn_validkeymaterial')
      .send({ originalUrl: 'https://example.com/path' })
      .expect(201);

    const body = response.body as { code: string; originalUrl: string };
    expect(body.code).toMatch(/^[A-Za-z0-9_-]{7}$/);
    expect(body.originalUrl).toBe('https://example.com/path');
    expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'key-1',
        service: 'url-shortener',
        endpoint: '/api/v1/short-url/shorten',
      },
    });
  });

  it('rejects POST /api/v1/short-url/shorten with no x-api-key header', () => {
    return request(app.getHttpServer())
      .post('/api/v1/short-url/shorten')
      .send({ originalUrl: 'https://example.com' })
      .expect(401);
  });

  it("lists only the calling API key's own short URLs via GET /api/v1/short-url", async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      revokedAt: null,
    });
    prismaMock.shortUrl.findMany.mockResolvedValue([
      {
        code: 'ccc3333',
        originalUrl: 'https://example.com/c',
        createdAt: new Date('2026-09-16T00:00:00Z'),
        clickCount: 0,
      },
    ]);
    prismaMock.shortUrl.count.mockResolvedValue(1);

    const response = await request(app.getHttpServer())
      .get('/api/v1/short-url')
      .set('x-api-key', 'nrn_validkeymaterial')
      .expect(200);

    expect(prismaMock.shortUrl.findMany).toHaveBeenCalledWith({
      where: { apiKeyId: 'key-1' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      skip: 0,
    });
    expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'key-1',
        service: 'url-shortener',
        endpoint: '/api/v1/short-url',
      },
    });
    expect(response.body).toEqual({
      items: [
        {
          code: 'ccc3333',
          originalUrl: 'https://example.com/c',
          createdAt: '2026-09-16T00:00:00.000Z',
          clickCount: 0,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
  });

  it('rejects GET /api/v1/short-url with no x-api-key header', () => {
    return request(app.getHttpServer()).get('/api/v1/short-url').expect(401);
  });

  it("lists the caller's own short URLs via the dashboard route, not the ApiKeyGuard", async () => {
    prismaMock.shortUrl.findMany.mockResolvedValue([
      {
        code: 'aaa1111',
        originalUrl: 'https://example.com/a',
        createdAt: new Date('2026-09-16T00:00:00Z'),
        clickCount: 3,
      },
    ]);
    prismaMock.shortUrl.count.mockResolvedValue(1);

    const response = await request(app.getHttpServer())
      .get('/short-url')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(prismaMock.shortUrl.findMany).toHaveBeenCalledWith({
      where: { apiKey: { userId: dashboardUser.id } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      skip: 0,
    });
    // Proves the literal '/short-url' route wasn't swallowed by the
    // catch-all GET ':code' handler, which would have called findUnique.
    expect(prismaMock.shortUrl.findUnique).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      items: [
        {
          code: 'aaa1111',
          originalUrl: 'https://example.com/a',
          createdAt: '2026-09-16T00:00:00.000Z',
          clickCount: 3,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
  });

  it('respects limit/offset query params on GET /short-url', async () => {
    prismaMock.shortUrl.findMany.mockResolvedValue([]);
    prismaMock.shortUrl.count.mockResolvedValue(0);

    await request(app.getHttpServer())
      .get('/short-url?limit=5&offset=10')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(prismaMock.shortUrl.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 }),
    );
  });

  it('rejects GET /short-url with no Authorization header', () => {
    return request(app.getHttpServer()).get('/short-url').expect(401);
  });

  it('shortens a URL from the dashboard via the hidden system key, and reuses it on a second call', async () => {
    const systemKey = {
      id: 'system-key-1',
      userId: dashboardUser.id,
      isSystemKey: true,
    };
    prismaMock.apiKey.findFirst.mockResolvedValue(systemKey);
    prismaMock.shortUrl.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'short-1',
          createdAt: new Date('2026-09-16T00:00:00Z'),
          clickCount: 0,
          ...data,
        }),
    );

    const response = await request(app.getHttpServer())
      .post('/short-url')
      .set('Authorization', 'Bearer valid-token')
      .send({ originalUrl: 'https://example.com/from-dashboard' })
      .expect(201);

    const body = response.body as { code: string; originalUrl: string };
    expect(body.originalUrl).toBe('https://example.com/from-dashboard');
    expect(prismaMock.apiKey.findFirst).toHaveBeenCalledWith({
      where: { userId: dashboardUser.id, isSystemKey: true },
    });
    expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
    expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'system-key-1',
        service: 'url-shortener',
        endpoint: '/short-url',
      },
    });
  });

  it('rejects POST /short-url with no Authorization header, without touching the DB', async () => {
    await request(app.getHttpServer())
      .post('/short-url')
      .send({ originalUrl: 'https://example.com' })
      .expect(401);

    expect(prismaMock.shortUrl.create).not.toHaveBeenCalled();
  });

  it('redirects GET /:code to the original URL and increments clickCount', async () => {
    prismaMock.shortUrl.findUnique.mockResolvedValue({
      code: 'abc1234',
      originalUrl: 'https://example.com/target',
      clickCount: 0,
    });

    await request(app.getHttpServer())
      .get('/abc1234')
      .expect(302)
      .expect('Location', 'https://example.com/target');

    expect(prismaMock.shortUrl.update).toHaveBeenCalledWith({
      where: { code: 'abc1234' },
      data: { clickCount: { increment: 1 } },
    });
  });

  it('returns 404 for an unknown code', async () => {
    prismaMock.shortUrl.findUnique.mockResolvedValue(null);

    // Well-formed (7 URL-safe chars) but not present in the DB.
    await request(app.getHttpServer()).get('/zzz9999').expect(404);
  });

  it('returns 400 for a malformed code, without querying the DB', async () => {
    // Wrong length for nanoid's 7-char codes.
    await request(app.getHttpServer()).get('/short').expect(400);

    expect(prismaMock.shortUrl.findUnique).not.toHaveBeenCalled();
  });

  it('does not let the catch-all /:code route shadow other top-level routes', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    expect(prismaMock.shortUrl.findUnique).not.toHaveBeenCalled();
  });
});
