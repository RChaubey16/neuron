import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import type { Resend } from 'resend';
import { RESEND_CLIENT } from './resend-client.provider';
import { CreateEmailDto } from './dto/create-email.dto';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly fromEmail: string;

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend,
    configService: ConfigService,
  ) {
    super();
    this.fromEmail = configService.getOrThrow<string>('RESEND_FROM_EMAIL');
  }

  /**
   * Sends one queued email job via Resend.
   * Rethrows any Resend failure so BullMQ's configured attempts/backoff on
   * the job retries it — this method must never swallow an error itself.
   * Note: the Resend SDK never rejects its promise — every failure mode
   * (bad API key, unverified domain, 4xx/5xx) resolves with
   * `{ data: null, error: {...} }` instead, so the failure/retry path
   * hinges on checking `error`, not on a try/catch.
   *
   * @param job - BullMQ job carrying the validated email payload
   */
  async process(job: Job<CreateEmailDto>): Promise<void> {
    const { data, error } = await this.resend.emails.send({
      from: this.fromEmail,
      to: job.data.to,
      subject: job.data.subject,
      html: job.data.body,
    });

    if (error) {
      this.logger.error(
        `Resend rejected email for job ${job.id}: ${error.name} (${error.statusCode ?? 'n/a'}): ${error.message}`,
      );
      throw new Error(`Resend error for job ${job.id}: ${error.message}`);
    }

    this.logger.log(`Sent email for job ${job.id} (resend id: ${data?.id})`);
  }
}
