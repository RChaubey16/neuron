import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage.module';
import { ShortUrlController } from './short-url.controller';
import { ShortUrlService } from './short-url.service';

@Module({
  imports: [UsageModule],
  controllers: [ShortUrlController],
  providers: [ShortUrlService],
})
export class ShortUrlModule {}
