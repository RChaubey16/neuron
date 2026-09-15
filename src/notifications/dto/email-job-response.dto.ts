import { Expose } from 'class-transformer';
import type { EmailJobStatus } from '../../../generated/prisma';

/** Shape of an `EmailJob` as returned by the queue/status/retry endpoints. `body` is omitted — it can be up to 100,000 chars and isn't needed to check on a job. */
export class EmailJobResponseDto {
  @Expose()
  id: string;

  @Expose()
  status: EmailJobStatus;

  @Expose()
  to: string[];

  @Expose()
  subject: string;

  @Expose()
  error: string | null;

  @Expose()
  attemptsMade: number;

  @Expose()
  resendId: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  constructor(
    partial: Pick<
      EmailJobResponseDto,
      | 'id'
      | 'status'
      | 'to'
      | 'subject'
      | 'error'
      | 'attemptsMade'
      | 'resendId'
      | 'createdAt'
      | 'updatedAt'
    >,
  ) {
    this.id = partial.id;
    this.status = partial.status;
    this.to = partial.to;
    this.subject = partial.subject;
    this.error = partial.error;
    this.attemptsMade = partial.attemptsMade;
    this.resendId = partial.resendId;
    this.createdAt = partial.createdAt;
    this.updatedAt = partial.updatedAt;
  }
}
