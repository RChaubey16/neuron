import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Request body for `POST /api-keys`. */
export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
