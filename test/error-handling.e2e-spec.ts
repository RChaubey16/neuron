import {
  Controller,
  Get,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { REQUEST_ID_HEADER } from './../src/common/request-id.middleware';

// Proves RequestIdMiddleware + GlobalExceptionFilter work together
// end-to-end without adding an unused production route.
@Controller('test-error')
class TestErrorController {
  @Get()
  boom() {
    throw new Error('leaked internal detail: table users column ssn');
  }

  @Get('not-found')
  missing() {
    throw new NotFoundException('thing not found');
  }
}

describe('Error handling (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestErrorController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a consistent JSON body for a NestJS HttpException (404)', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-error/not-found')
      .expect(404);

    expect(res.body).toMatchObject({
      statusCode: 404,
      message: 'thing not found',
      error: 'Not Found',
      path: '/test-error/not-found',
    });
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('requestId');
  });

  it('masks a raw thrown Error as a generic 500 and never leaks its message', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-error')
      .expect(500);

    expect(res.body).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
    expect(JSON.stringify(res.body)).not.toContain('ssn');
  });

  it('sets an X-Request-Id response header matching the error body requestId', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-error')
      .expect(500);

    const body = res.body as { requestId: string };
    expect(res.headers[REQUEST_ID_HEADER]).toBeDefined();
    expect(body.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
  });

  it('echoes back a caller-supplied X-Request-Id instead of generating a new one', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-error')
      .set(REQUEST_ID_HEADER, 'caller-supplied-id')
      .expect(500);

    const body = res.body as { requestId: string };
    expect(res.headers[REQUEST_ID_HEADER]).toBe('caller-supplied-id');
    expect(body.requestId).toBe('caller-supplied-id');
  });
});
