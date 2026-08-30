import { Expose } from 'class-transformer';

/** Shape of a `ShortUrl` as returned by `POST /shorten` — no full absolute short link, since no public base URL is configured until deployment (Phase 8). */
export class ShortUrlResponseDto {
  @Expose()
  code: string;

  @Expose()
  originalUrl: string;

  @Expose()
  createdAt: Date;

  @Expose()
  clickCount: number;

  constructor(
    partial: Pick<
      ShortUrlResponseDto,
      'code' | 'originalUrl' | 'createdAt' | 'clickCount'
    >,
  ) {
    this.code = partial.code;
    this.originalUrl = partial.originalUrl;
    this.createdAt = partial.createdAt;
    this.clickCount = partial.clickCount;
  }
}
