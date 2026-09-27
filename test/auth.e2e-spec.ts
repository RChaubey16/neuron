import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('AuthController (e2e)', () => {
  let app: INestApplication<App>;
  const jwtServiceMock = { verifyAsync: jest.fn(), signAsync: jest.fn() };
  const prismaMock = {
    user: { upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(JwtService)
      .useValue(jwtServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('/me (GET) returns the logged-in user for a valid session token', async () => {
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
    });

    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect({ id: 'user-1', email: 'user@example.com' });

    expect(prismaMock.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('/me (GET) rejects requests without a token', () => {
    return request(app.getHttpServer()).get('/me').expect(401);
  });

  it('/me (GET) rejects an invalid token', () => {
    jwtServiceMock.verifyAsync.mockRejectedValue(new Error('jwt malformed'));

    return request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('/auth/google/callback (GET) sends a cancelled sign-in back to the dashboard instead of rendering JSON', async () => {
    // Exactly what Google redirects back with when the user clicks "Cancel"
    // on the consent screen; passport-oauth2 turns it into an auth failure
    // before any token exchange happens, so no Google mock is needed.
    const response = await request(app.getHttpServer())
      .get('/auth/google/callback?error=access_denied')
      .expect(302);

    expect(response.headers.location).toBe(
      `${process.env.FRONTEND_URL}/auth/callback#error=access_denied`,
    );
  });
});
