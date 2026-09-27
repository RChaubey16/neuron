import {
  Controller,
  Get,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import type { Response } from 'express';
import { AuthService, GoogleProfile } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserResponseDto } from './dto/user-response.dto';
import { OAuthCallbackRedirectFilter } from './filters/oauth-callback-redirect.filter';
import type { User } from '../../generated/prisma';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('auth/google')
  @UseGuards(AuthGuard('google'))
  googleLogin(): void {
    // AuthGuard('google') redirects to Google before this body runs.
  }

  @Get('auth/google/callback')
  @UseGuards(AuthGuard('google'))
  @UseFilters(OAuthCallbackRedirectFilter)
  async googleCallback(
    @Req() req: Request & { user: GoogleProfile },
    @Res() res: Response,
  ): Promise<void> {
    const user = await this.authService.findOrCreateUser(req.user);
    const token = await this.authService.signToken(user);
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    res.redirect(`${frontendUrl}/auth/callback#token=${token}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@CurrentUser() user: User): UserResponseDto {
    return new UserResponseDto(user);
  }
}
