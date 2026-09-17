import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

/** Query params for `GET /notifications/email`. */
export class ListEmailJobsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_LIMIT)
  limit: number = DEFAULT_LIST_LIMIT;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
