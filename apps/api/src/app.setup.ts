import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  API_KEY_HEADER,
  API_PREFIX,
} from '@/common/constants/api.constants.js';
import { AppConfig } from '@/config/configuration.js';

/**
 * App-level settings that cannot be registered as module providers.
 * Shared by main.ts and the e2e tests so both run the same setup.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<AppConfig, true>);
  const corsOrigins = config.get('cors.origins', { infer: true });

  app.setGlobalPrefix(API_PREFIX);

  app.enableCors({
    // Only the configured web app origins. An empty list allows none.
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', API_KEY_HEADER],
    credentials: false,
    maxAge: 600,
  });

  app.enableShutdownHooks();
}
