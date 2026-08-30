import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage.module';
import { ApiKeyModule } from '../api-keys/api-keys.module';
import { ShortUrlController } from './short-url.controller';
import { ShortUrlService } from './short-url.service';

@Module({
  // ApiKeyModule is imported explicitly for ApiKeyGuard, even though Nest's
  // class-referenced guard/interceptor resolution would find it globally
  // regardless — an explicit import documents the real dependency instead
  // of relying on that implicit lookup.
  imports: [UsageModule, ApiKeyModule],
  controllers: [ShortUrlController],
  providers: [ShortUrlService],
})
export class ShortUrlModule {}
