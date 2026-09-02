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
   * A downstream Resend failure is EmailProcessor's concern, handled via
   * BullMQ's own retry/backoff on the job, not by this method.
   * Note: if Redis is unreachable, this call does NOT reliably throw — ioredis's
   * offline-queue buffering can cause it to hang instead of failing fast. This is a
   * known gap (see CLAUDE.md's gotchas section), not yet fixed.
   *
   * @param dto - Validated recipients/subject/body payload
   * @returns Nothing — queues the job asynchronously
   */
  async queueEmail(dto: CreateEmailDto): Promise<void> {
    await this.emailQueue.add('send', dto, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000, age: 86_400 },
      removeOnFail: { count: 5000 },
    });
  }
}
