import { Expose } from 'class-transformer';

/** One row of the caller's usage aggregate: call count for a service/day/key combination. */
export class UsageSummaryDto {
  @Expose()
  service: string;

  @Expose()
  date: string;

  @Expose()
  apiKeyId: string;

  @Expose()
  count: number;

  constructor(
    partial: Pick<UsageSummaryDto, 'service' | 'date' | 'apiKeyId' | 'count'>,
  ) {
    this.service = partial.service;
    this.date = partial.date;
    this.apiKeyId = partial.apiKeyId;
    this.count = partial.count;
  }
}
