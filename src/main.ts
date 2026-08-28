import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  await app.listen(configService.get<number>('PORT') ?? 3000);
}
bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error('Failed to start application', error);
  process.exit(1);
});
