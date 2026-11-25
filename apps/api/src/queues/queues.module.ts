import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_QUEUE } from '@neuron/core';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { RedisHealthService } from './redis-health.service.js';

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Redis connection and the queues the API adds jobs to. Global, so the email
 * endpoint and the health check share one Queue instance and connection.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const url: string = config.get('REDIS_URL', { infer: true });
        return {
          connection: {
            url,
            // Fail commands straight away while Redis is unreachable instead of
            // buffering them, so an HTTP request gets an error rather than hanging.
            enableOfflineQueue: false,
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: EMAIL_QUEUE,
      defaultJobOptions: {
        // Postgres keeps each message's status, so jobs don't need to stay in
        // Redis for long once they finish.
        removeOnComplete: { age: DAY_SECONDS, count: 10_000 },
        removeOnFail: { age: 7 * DAY_SECONDS },
      },
    }),
  ],
  providers: [RedisHealthService],
  exports: [BullModule, RedisHealthService],
})
export class QueuesModule {}
