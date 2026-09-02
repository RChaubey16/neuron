import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsageModule } from '../usage/usage.module';
import { ApiKeyModule } from '../api-keys/api-keys.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailProcessor } from './email.processor';
import { resendClientProvider } from './resend-client.provider';

@Module({
  // ApiKeyModule/UsageModule are imported explicitly for
  // ApiKeyGuard/UsageLoggingInterceptor, matching ShortUrlModule's
  // convention — Nest would resolve them globally regardless, but the
  // import documents the real dependency.
  imports: [
    UsageModule,
    ApiKeyModule,
    BullModule.registerQueue({ name: 'email' }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailProcessor, resendClientProvider],
})
export class NotificationsModule {}
