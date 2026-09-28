import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage.module';
import { ApiKeyModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailProcessor } from './processors/email.processor';
import { resendClientProvider } from './providers/resend-client.provider';
import { emailQueueProvider } from './providers/email-queue.provider';

@Module({
  // ApiKeyModule/UsageModule are imported explicitly for
  // ApiKeyGuard/UsageLoggingInterceptor, matching ShortUrlModule's
  // convention — Nest would resolve them globally regardless, but the
  // import documents the real dependency. AuthModule is needed for
  // JwtAuthGuard's own JwtService dependency (see the "JwtModule must be
  // re-exported from AuthModule" gotcha) now that the dashboard routes use it.
  // RedisModule supplies the fail-fast connection emailQueueProvider builds
  // the producer queue on (see that provider for why it isn't registered
  // through BullModule.registerQueue). WebhooksModule lets EmailProcessor
  // emit email.sent/email.failed.
  imports: [UsageModule, ApiKeyModule, AuthModule, RedisModule, WebhooksModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    EmailProcessor,
    resendClientProvider,
    emailQueueProvider,
  ],
})
export class NotificationsModule {}
