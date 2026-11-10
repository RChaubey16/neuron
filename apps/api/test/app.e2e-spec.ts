import {
  Body,
  Controller,
  Get,
  INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

class EchoDto {
  @IsString()
  @MinLength(2)
  name: string;
}

@Controller('test')
class TestController {
  @Post('echo')
  echo(@Body() dto: EchoDto): EchoDto {
    return dto;
  }

  @Get('boom')
  boom(): never {
    throw new Error('internal detail that must not leak');
  }
}

@Module({ controllers: [TestController] })
class TestFeatureModule {}

const WEB_ORIGIN = 'http://localhost:3001';

describe('App setup (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.CORS_ORIGINS = WEB_ORIGIN;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, TestFeatureModule],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves routes under /api/v1', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .send({ name: 'neuron' })
      .expect(201, { name: 'neuron' });

    await request(app.getHttpServer()).post('/test/echo').expect(404);
  });

  it('returns the structured error shape for unknown routes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);

    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/api/v1/does-not-exist',
    });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('rejects invalid bodies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .send({ name: 'x' })
      .expect(400);

    expect(res.body.error).toBe('Bad Request');
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('name')]),
    );
  });

  it('rejects unknown properties', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .send({ name: 'neuron', isAdmin: true })
      .expect(400);

    expect(res.body.message).toEqual(
      expect.arrayContaining(['property isAdmin should not exist']),
    );
  });

  it('hides unexpected error details', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test/boom')
      .expect(500);

    expect(res.body.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('internal detail');
  });

  it('allows CORS only for configured origins', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/api/v1/test/echo')
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);

    const blocked = await request(app.getHttpServer())
      .options('/api/v1/test/echo')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
