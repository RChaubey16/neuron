import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseJwtGuard } from './guards/supabase-jwt.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SupabaseJwtGuard],
  exports: [AuthService, SupabaseJwtGuard],
})
export class AuthModule {}
