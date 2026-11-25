import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { AuthModule } from './auth/auth.module.js';
import { EmailsModule } from './emails/emails.module.js';
import { validateEnv } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { QueuesModule } from './queues/queues.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Local development reads the repo-root .env (scripts run from apps/api).
      // In production the variables come from Coolify and no file is present.
      // Variables already set in the environment take precedence over the file.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    QueuesModule,
    HealthModule,
    AuthModule,
    ApiKeysModule,
    EmailsModule,
  ],
})
export class AppModule {}
