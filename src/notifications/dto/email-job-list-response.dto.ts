import { Expose } from 'class-transformer';
import { EmailJobResponseDto } from './email-job-response.dto';

/** Shape of `GET /notifications/email`'s paginated response. */
export class EmailJobListResponseDto {
  @Expose()
  items: EmailJobResponseDto[];

  @Expose()
  total: number;

  @Expose()
  limit: number;

  @Expose()
  offset: number;

  constructor(
    partial: Pick<
      EmailJobListResponseDto,
      'items' | 'total' | 'limit' | 'offset'
    >,
  ) {
    this.items = partial.items;
    this.total = partial.total;
    this.limit = partial.limit;
    this.offset = partial.offset;
  }
}
