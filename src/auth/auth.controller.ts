import { Controller, Get, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from './guards/supabase-jwt.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserResponseDto } from './dto/user-response.dto';
import type { User } from '../../generated/prisma';

@Controller()
export class AuthController {
  @Get('me')
  @UseGuards(SupabaseJwtGuard)
  getProfile(@CurrentUser() user: User): UserResponseDto {
    return new UserResponseDto(user);
  }
}
