import { ApiProperty } from '@nestjs/swagger';
import type { Profile } from '@/generated/prisma/client.js';

export class ProfileResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Supabase user ID',
    example: '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60',
  })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Email from the Google account, kept in sync on sign-in',
    example: 'ada@example.com',
  })
  email: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Ada Lovelace' })
  fullName: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://example.com/avatar.png',
  })
  avatarUrl: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-11-11T09:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time', example: '2026-11-11T09:00:00.000Z' })
  updatedAt: Date;
}

/**
 * Maps a stored profile to its API representation.
 *
 * @param profile - Profile row.
 * @returns The profile as returned by the API.
 */
export function toProfileResponse(profile: Profile): ProfileResponseDto {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
