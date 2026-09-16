import { Expose } from 'class-transformer';

/** Shape of a `ShortUrl` as returned by `POST /shorten` — no full absolute short link, since no public base URL env var is wired in yet (the app is deployed at neuron-api.ruturaj.xyz as of Phase 8, but nothing in this service reads that as config); callers must build the link themselves. */
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
