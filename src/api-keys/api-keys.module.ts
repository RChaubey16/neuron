import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeyController } from './api-keys.controller';
import { ApiKeyService } from './api-keys.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { DashboardApiKeyGuard } from './guards/dashboard-api-key.guard';

@Module({
  imports: [AuthModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService, ApiKeyGuard, DashboardApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard, DashboardApiKeyGuard],
})
export class ApiKeyModule {}
