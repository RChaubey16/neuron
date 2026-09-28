import { Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { PRODUCER_REDIS } from '../../redis/redis.module';

export const EMAIL_QUEUE = 'EMAIL_QUEUE';

/**
 * The producer side of the `email` queue, built on the fail-fast
 * `PRODUCER_REDIS` connection. It's deliberately not registered through
 * `BullModule.registerQueue`: `@nestjs/bullmq` gives a `@Processor` worker
 * its queue's connection options, which would put the worker on the
 * fail-fast connection too. With no registered queue, `EmailProcessor`
 * falls back to `BullModule.forRoot`'s default connection.
 */
export const emailQueueProvider: Provider = {
  provide: EMAIL_QUEUE,
  useFactory: (redis: Redis) => new Queue('email', { connection: redis }),
  inject: [PRODUCER_REDIS],
};
