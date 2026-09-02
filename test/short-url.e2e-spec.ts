import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('ShortUrl (e2e)', () => {
  let app: INestApplication<App>;
  const prismaMock = {
    apiKey: { findFirst: jest.fn(), update: jest.fn() },
    usageLog: { create: jest.fn() },
    shortUrl: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    prismaMock.apiKey.update.mockResolvedValue({});
    prismaMock.usageLog.create.mockResolvedValue({});
    prismaMock.shortUrl.update.mockResolvedValue({});

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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

    await request(app.getHttpServer()).get('/nosuchcode').expect(404);
  });

  it('does not let the catch-all /:code route shadow other top-level routes', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    expect(prismaMock.shortUrl.findUnique).not.toHaveBeenCalled();
  });
});
