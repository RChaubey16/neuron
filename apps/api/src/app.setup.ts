import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * App-wide setup shared by main.ts and the e2e tests, so tests run against
 * the same pipeline as production.
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.disable('x-powered-by');
  app.enableShutdownHooks();
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
