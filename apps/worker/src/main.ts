import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { EnvironmentVariables } from './config/env.validation.js';
import { WorkerModule } from './worker.module.js';

/**
 * The worker has no HTTP server: it's a Nest application context whose
 * BullMQ worker pulls jobs from Redis until the process is stopped. On SIGTERM
 * it stops taking jobs and waits for the ones in progress to finish.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  Logger.log(
    `Worker started: provider ${config.get('EMAIL_PROVIDER', { infer: true })}, ` +
      `concurrency ${config.get('WORKER_CONCURRENCY', { infer: true })}`,
    'Bootstrap',
  );
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : error, 'Bootstrap');
  process.exit(1);
});
