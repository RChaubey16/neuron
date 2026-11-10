import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module.js';
import { configureApp } from '@/app.setup.js';
import { AppConfig } from '@/config/configuration.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = app.get(ConfigService<AppConfig, true>).get('port', {
    infer: true,
  });
  await app.listen(port, '0.0.0.0');
  Logger.log(`Neuron API listening on port ${port}`, 'Bootstrap');
}

await bootstrap();
