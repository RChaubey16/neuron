import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { jwtVerify } from 'jose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

describe('AuthController (e2e)', () => {
  let app: INestApplication<App>;
  const mockJwtVerify = jwtVerify as jest.Mock;
  const prismaMock = { user: { upsert: jest.fn() } };

  beforeEach(async () => {
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

  it('/me (GET) returns the synced user for a valid Supabase token', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'user-1', email: 'user@example.com' },
    });
    prismaMock.user.upsert.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
    });

    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect({ id: 'user-1', email: 'user@example.com' });

    expect(prismaMock.user.upsert).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      update: {},
      create: { id: 'user-1', email: 'user@example.com' },
    });
  });

  it('/me (GET) rejects requests without a token', () => {
    return request(app.getHttpServer()).get('/me').expect(401);
  });

  it('/me (GET) rejects an invalid token', () => {
    mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));

    return request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });
});
