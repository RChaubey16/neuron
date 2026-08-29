import { Expose } from 'class-transformer';

/** Shape of an `ApiKey` as returned to dashboard clients — never includes the raw key or its hash. */
export class ApiKeyResponseDto {
  @Expose()
  id: string;

  @Expose()
  keyPrefix: string;

  @Expose()
  name: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  lastUsedAt: Date | null;

  @Expose()
  revokedAt: Date | null;

  constructor(
    partial: Pick<
      ApiKeyResponseDto,
      'id' | 'keyPrefix' | 'name' | 'createdAt' | 'lastUsedAt' | 'revokedAt'
    >,
  ) {
    this.id = partial.id;
    this.keyPrefix = partial.keyPrefix;
    this.name = partial.name;
    this.createdAt = partial.createdAt;
    this.lastUsedAt = partial.lastUsedAt;
    this.revokedAt = partial.revokedAt;
  }
}
