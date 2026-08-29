import { Expose } from 'class-transformer';
import { ApiKeyResponseDto } from './api-key-response.dto';

/** Response for `POST /api-keys` only — the one moment the raw key is ever exposed. */
export class CreatedApiKeyResponseDto extends ApiKeyResponseDto {
  @Expose()
  key: string;

  constructor(
    partial: Pick<
      ApiKeyResponseDto,
      'id' | 'keyPrefix' | 'name' | 'createdAt' | 'lastUsedAt' | 'revokedAt'
    > & { key: string },
  ) {
    super(partial);
    this.key = partial.key;
  }
}
