import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateEmailDto } from './dto/create-email.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue<CreateEmailDto>,
  ) {}

  /**
   * Queues a validated email payload for asynchronous delivery.
   * Only throws if the queue itself can't accept the job (e.g. Redis is
   * unreachable) — that propagates as a 500 via GlobalExceptionFilter.
   * A downstream Resend failure is EmailProcessor's concern, handled via
   * BullMQ's own retry/backoff on the job, not by this method.
   *
   * @param dto - Validated recipients/subject/body payload
   * @returns Nothing — queues the job asynchronously
   */
  async queueEmail(dto: CreateEmailDto): Promise<void> {
    await this.emailQueue.add('send', dto, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
