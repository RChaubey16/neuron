import { Expose } from 'class-transformer';
import { ShortUrlResponseDto } from './short-url-response.dto';

/** Shape of `GET /short-url`'s paginated response. */
export class ShortUrlListResponseDto {
  @Expose()
  items: ShortUrlResponseDto[];

  @Expose()
  total: number;

  @Expose()
  limit: number;

  @Expose()
  offset: number;

  constructor(
    partial: Pick<
      ShortUrlListResponseDto,
      'items' | 'total' | 'limit' | 'offset'
    >,
  ) {
    this.items = partial.items;
    this.total = partial.total;
    this.limit = partial.limit;
    this.offset = partial.offset;
  }
}
