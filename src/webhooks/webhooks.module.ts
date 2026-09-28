import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage.module';
import { ApiKeyModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookProcessor } from './processors/webhook.processor';
import { webhookQueueProvider } from './providers/webhook-queue.provider';
import { webhookHttpClientProvider } from './delivery/webhook-http-client';

@Module({
  // Same imports as NotificationsModule, for the same reasons: the guards
  // and interceptor its routes use, and the fail-fast producer connection.
  imports: [UsageModule, ApiKeyModule, AuthModule, RedisModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookProcessor,
    webhookQueueProvider,
    webhookHttpClientProvider,
  ],
  // Exported so modules that own an event's state change (e.g.
  // NotificationsModule) can emit it.
  exports: [WebhooksService],
})
export class WebhooksModule {}
