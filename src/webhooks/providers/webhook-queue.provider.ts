import { Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { PRODUCER_REDIS } from '../../redis/redis.module';

export const WEBHOOK_QUEUE = 'WEBHOOK_QUEUE';

export interface WebhookJobData {
  deliveryId: string;
}

/**
 * The producer side of the `webhook` queue, on the fail-fast
 * `PRODUCER_REDIS` connection — not registered through
 * `BullModule.registerQueue` for the same reason as `emailQueueProvider`,
 * so `WebhookProcessor` falls back to `BullModule.forRoot`'s connection.
 */
export const webhookQueueProvider: Provider = {
  provide: WEBHOOK_QUEUE,
  useFactory: (redis: Redis) =>
    new Queue<WebhookJobData>('webhook', { connection: redis }),
  inject: [PRODUCER_REDIS],
};
