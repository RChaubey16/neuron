import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_QUEUE } from '@neuron/core';
import { type EnvironmentVariables, validateEnv } from './config/env.validation.js';
import { EmailModule } from './email/email.module.js';
import { MessageSender } from './messages/message-sender.service.js';
import { SendEmailProcessor } from './messages/send-email.processor.js';
import { PrismaModule } from './prisma/prisma.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Local development reads the repo-root .env (scripts run from apps/worker).
      // In production the variables come from Coolify. Variables already set in
      // the environment take precedence over the file.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const url: string = config.get('REDIS_URL', { infer: true });
        return {
          // BullMQ workers hold blocking connections and must retry commands
          // forever across Redis restarts rather than give up.
          connection: { url, maxRetriesPerRequest: null },
        };
      },
    }),
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
    EmailModule,
  ],
  providers: [MessageSender, SendEmailProcessor],
})
export class WorkerModule {}
