import { Controller, Get, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from './guards/supabase-jwt.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { User } from '../../generated/prisma';

@Controller()
export class AuthController {
  @Get('me')
  @UseGuards(SupabaseJwtGuard)
  getProfile(@CurrentUser() user: User): User {
    return user;
  }
}
