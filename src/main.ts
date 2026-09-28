import {
  ClassSerializerInterceptor,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { StructuredLogger } from './common/logging/structured-logger.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new StructuredLogger(),
  });
  app.enableShutdownHooks();
  // Production sits behind exactly one reverse proxy (Coolify's Traefik).
  // Without this, req.ip is the proxy's address, so the IP-keyed rate
  // limit (every caller without an API key) would be one bucket shared by
  // all users. Trusting one hop takes the address Traefik appended to
  // X-Forwarded-For, which a client can't forge.
  app.set('trust proxy', 1);

  const configService = app.get(ConfigService);
  app.enableCors({
    origin: configService.getOrThrow<string>('FRONTEND_URL'),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  await app.listen(configService.get<number>('PORT') ?? 3000);
}
bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error('Failed to start application', error);
  process.exit(1);
});
