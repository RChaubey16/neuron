import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { EnvironmentVariables } from './config/env.validation.js';

/**
 * App-wide setup shared by main.ts and the e2e tests, so tests run against
 * the same pipeline as production.
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.disable('x-powered-by');
  app.enableShutdownHooks();

  // The secret signs cookies that must not be tampered with (the OAuth state cookie).
  app.use(cookieParser(config.get('SESSION_SECRET', { infer: true })));

  // Only the dashboard may call the API from a browser, with its session cookie.
  // Public API clients call from servers, where CORS doesn't apply.
  app.enableCors({
    origin: new URL(config.get('WEB_URL', { infer: true })).origin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties that have no decorator, and reject requests that send them.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  return app;
}
