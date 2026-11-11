import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export const FULL_NAME_MAX_LENGTH = 100;
export const AVATAR_URL_MAX_LENGTH = 2048;

/**
 * Fields a user may change on their profile. Omit a field to keep it;
 * send `null` to clear it. Email is managed by Google and Supabase.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: FULL_NAME_MAX_LENGTH,
    description: 'Display name, trimmed. `null` clears it.',
    example: 'Ada Lovelace',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(FULL_NAME_MAX_LENGTH)
  fullName?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uri',
    maxLength: AVATAR_URL_MAX_LENGTH,
    description: 'HTTPS URL of the avatar image. `null` clears it.',
    example: 'https://example.com/avatar.png',
  })
  @IsOptional()
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'avatarUrl must be an https URL' },
  )
  @MaxLength(AVATAR_URL_MAX_LENGTH)
  avatarUrl?: string | null;
}
