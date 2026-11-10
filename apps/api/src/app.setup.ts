import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  API_KEY_HEADER,
  API_PREFIX,
  DOCS_PATH,
  OPENAPI_JSON_PATH,
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

  setupSwagger(app);
}

/**
 * Serves Swagger UI at /api/v1/docs and the OpenAPI document at
 * /api/v1/openapi.json (the web app's API reference reads it).
 * Full endpoint documentation comes in Phase 5.
 */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Neuron API')
      .setDescription('Reusable platform services through REST APIs.')
      .setVersion('1.0')
      .build(),
  );

  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
  });
}
