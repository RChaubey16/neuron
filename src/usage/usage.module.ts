import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
import { UsageLoggingInterceptor } from './interceptors/usage-logging.interceptor';

@Module({
  imports: [AuthModule],
  controllers: [UsageController],
  providers: [UsageService, UsageLoggingInterceptor],
  exports: [UsageLoggingInterceptor],
})
export class UsageModule {}
