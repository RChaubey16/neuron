import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js';
import configuration from '@/config/configuration.js';
import { validate } from '@/config/validation.js';
import { HealthModule } from '@/health/health.module.js';
import { PrismaModule } from '@/prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Docker Compose injects variables from the repo-root .env, so no
      // .env file is read from inside the container.
      ignoreEnvFile: true,
      load: [configuration],
      validate,
    }),
    PrismaModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
