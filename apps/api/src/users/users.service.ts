import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthErrorMessage } from '@/auth/auth.constants.js';
import type { AuthUser } from '@/common/interfaces/auth-user.interface.js';
import type { Profile } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the user's profile, creating it on first use.
   *
   * A new profile takes its email, name, and avatar from the token. Later
   * calls keep the email in sync but never overwrite the name or avatar,
   * so edits made through `updateProfile` stick.
   *
   * @param user - Authenticated user.
   * @returns The user's profile.
   * @throws UnauthorizedException when the Supabase user no longer exists.
   */
  async getOrCreateProfile(user: AuthUser): Promise<Profile> {
    const existing = await this.prisma.profile.findUnique({
      where: { id: user.id },
    });
    if (!existing) {
      return this.createProfile(user);
    }

    if (user.email !== null && existing.email !== user.email) {
      return this.prisma.profile.update({
        where: { id: user.id },
        data: { email: user.email },
      });
    }
    return existing;
  }

  /**
   * Updates the user's name and avatar, creating the profile if needed.
   *
   * @param user - Authenticated user.
   * @param dto - Fields to change; omitted fields are kept, `null` clears.
   * @returns The updated profile.
   * @throws UnauthorizedException when the Supabase user no longer exists.
   */
  async updateProfile(user: AuthUser, dto: UpdateProfileDto): Promise<Profile> {
    await this.getOrCreateProfile(user);
    return this.prisma.profile.update({
      where: { id: user.id },
      data: { fullName: dto.fullName, avatarUrl: dto.avatarUrl },
    });
  }

  /**
   * Creates a profile from the token's data.
   *
   * profiles has no foreign key to auth.users, so the insert itself checks
   * that the Supabase user still exists. `ON CONFLICT DO NOTHING` covers a
   * concurrent request creating the same profile.
   *
   * @param user - Authenticated user without a profile yet.
   * @returns The new profile, or the one a concurrent request created.
   * @throws UnauthorizedException when the Supabase user no longer exists
   *   (deleted while their token is still valid).
   */
  private async createProfile(user: AuthUser): Promise<Profile> {
    await this.prisma.$executeRaw`
      INSERT INTO public.profiles (id, email, full_name, avatar_url)
      SELECT ${user.id}::uuid, ${user.email}::text, ${user.fullName}::text,
             ${user.avatarUrl}::text
      WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = ${user.id}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    const profile = await this.prisma.profile.findUnique({
      where: { id: user.id },
    });
    if (!profile) {
      throw new UnauthorizedException(AuthErrorMessage.Invalid);
    }
    return profile;
  }
}
