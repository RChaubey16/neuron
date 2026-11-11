import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '@/common/decorators/current-user.decorator.js';
import type { AuthUser } from '@/common/interfaces/auth-user.interface.js';
import {
  ProfileResponseDto,
  toProfileResponse,
} from './dto/profile-response.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid, or expired access token',
})
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Returns the signed-in user's profile, creating it on first call.
   *
   * @param user - Authenticated user.
   * @returns The profile.
   */
  @Get('me')
  @ApiOperation({
    summary: 'Get my profile',
    description:
      'Creates the profile from the Google account on the first call. ' +
      'The web app calls this after every sign-in.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  async getMe(@CurrentUser() user: AuthUser): Promise<ProfileResponseDto> {
    return toProfileResponse(await this.users.getOrCreateProfile(user));
  }

  /**
   * Updates the signed-in user's name and avatar.
   *
   * @param user - Authenticated user.
   * @param dto - Fields to change.
   * @returns The updated profile.
   */
  @Patch('me')
  @ApiOperation({ summary: 'Update my profile' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid or unknown fields' })
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return toProfileResponse(await this.users.updateProfile(user, dto));
  }
}
