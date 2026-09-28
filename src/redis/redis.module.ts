import { Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const PRODUCER_REDIS = 'PRODUCER_REDIS';

/**
 * A Redis connection for request-path work only (queue producers and the
 * readiness check), configured to fail fast instead of waiting for Redis
 * to come back. BullMQ workers keep their own connection from
 * `BullModule.forRoot`, since BullMQ advises against disabling the offline
 * queue on a worker.
 */
@Module({
  providers: [
    {
      provide: PRODUCER_REDIS,
      useFactory: async (configService: ConfigService) => {
        const logger = new Logger('RedisModule');
        const redis = new Redis({
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
          // Without these, ioredis buffers commands while disconnected and
          // replays them on reconnect, so a request made during an outage
          // hangs instead of erroring.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        // Without a listener, ioredis reports every failed reconnect as an
        // unhandled error event.
        redis.on('error', (error) =>
          logger.warn(`Producer Redis connection error: ${error.message}`),
        );
        // With the offline queue off, commands are rejected until the
        // connection is ready, so the first requests after boot would see
        // Redis as down. Wait for the first connection attempt to settle,
        // but don't block startup if Redis is down: ioredis keeps retrying.
        await new Promise<void>((resolve) => {
          redis.once('ready', resolve);
          redis.once('error', () => resolve());
        });
        return redis;
      },
      inject: [ConfigService],
    },
  ],
  exports: [PRODUCER_REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(PRODUCER_REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // quit() needs a live connection to send QUIT; if Redis is already
    // down, drop the socket instead.
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
