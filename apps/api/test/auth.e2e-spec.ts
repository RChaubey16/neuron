import {
  Controller,
  Get,
  INestApplication,
  Module,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { SUPABASE_JWKS } from '../src/auth/auth.constants.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../src/common/decorators/current-user.decorator.js';
import { Public } from '../src/common/decorators/public.decorator.js';
import type { AuthUser } from '../src/common/interfaces/auth-user.interface.js';
import {
  createTestTokenSigner,
  TEST_USER_ID,
  type TestTokenSigner,
} from './support/supabase-tokens.js';

@Controller('test-auth')
@UseGuards(JwtAuthGuard)
class TestAuthController {
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Get('id')
  id(@CurrentUser('id') id: string): { id: string } {
    return { id };
  }

  @Public()
  @Get('public')
  open(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ imports: [AuthModule], controllers: [TestAuthController] })
class TestAuthModule {}

describe('Supabase JWT authentication (e2e)', () => {
  let app: INestApplication<App>;
  let signer: TestTokenSigner;

  beforeAll(async () => {
    signer = await createTestTokenSigner();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, TestAuthModule],
    })
      .overrideProvider(SUPABASE_JWKS)
      .useValue(signer.jwks)
      .compile();

    app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the current user for a valid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-auth/me')
      .set('Authorization', `Bearer ${await signer.sign()}`)
      .expect(200);

    expect(res.body).toEqual({
      id: TEST_USER_ID,
      email: 'user@example.com',
      fullName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
    });
  });

  it('injects a single field with @CurrentUser(field)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/test-auth/id')
      .set('Authorization', `Bearer ${await signer.sign()}`)
      .expect(200, { id: TEST_USER_ID });
  });

  it('returns 401 in the standard error shape without a token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-auth/me')
      .expect(401);

    expect(res.body).toMatchObject({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing bearer token',
      path: '/api/v1/test-auth/me',
    });
  });

  it('returns 401 for an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signer.sign({ iat: now - 7200, exp: now - 3600 });
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(res.body.message).toBe('Access token has expired');
  });

  it('returns 401 for an invalid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-auth/me')
      .set('Authorization', `Bearer ${await signer.sign({ aud: 'anon' })}`)
      .expect(401);

    expect(res.body.message).toBe('Invalid access token');
  });

  it('lets @Public() routes through without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/test-auth/public')
      .expect(200, { ok: true });
  });

  it('documents bearer auth in the OpenAPI document', async () => {
    const spec = await request(app.getHttpServer())
      .get('/api/v1/openapi.json')
      .expect(200);

    expect(spec.body.components.securitySchemes.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });
});
