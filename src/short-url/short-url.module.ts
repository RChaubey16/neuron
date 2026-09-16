import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage.module';
import { ApiKeyModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { ShortUrlController } from './short-url.controller';
import { ShortUrlService } from './short-url.service';

@Module({
  // ApiKeyModule/AuthModule are imported explicitly for ApiKeyGuard/
  // JwtAuthGuard, even though Nest's class-referenced guard resolution would
  // find them globally regardless — an explicit import documents the real
  // dependency instead of relying on that implicit lookup. AuthModule is
  // also where JwtAuthGuard's own JwtService dependency resolves from (see
  // the "JwtModule must be re-exported from AuthModule" gotcha).
  imports: [UsageModule, ApiKeyModule, AuthModule],
  controllers: [ShortUrlController],
  providers: [ShortUrlService],
})
export class ShortUrlModule {}
