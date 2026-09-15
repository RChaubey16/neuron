import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import type { Resend } from 'resend';
import { RESEND_CLIENT } from '../providers/resend-client.provider';
import { CreateEmailDto } from '../dto/create-email.dto';
import { PrismaService } from '../../prisma/prisma.service';

interface EmailJobResult {
  resendId: string | undefined;
}

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly fromEmail: string;

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend,
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super();
    this.fromEmail = configService.getOrThrow<string>('RESEND_FROM_EMAIL');
  }

  /**
   * Sends one queued email job via Resend.
   * Rethrows any Resend failure so BullMQ's configured attempts/backoff on
   * the job retries it — this method must never swallow an error itself.
   * The EmailJob record's status (PROCESSING/SENT/FAILED) is kept in sync
   * separately, from the worker-event handlers below rather than from
   * here, since only BullMQ itself knows whether a failed attempt still
   * has retries left.
   * Note: the Resend SDK never rejects its promise — every failure mode
   * (bad API key, unverified domain, 4xx/5xx) resolves with
   * `{ data: null, error: {...} }` instead, so the failure/retry path
   * hinges on checking `error`, not on a try/catch.
   *
   * @param job - BullMQ job carrying the validated email payload
   * @returns The Resend delivery id, read by the `completed` handler
   */
  async process(job: Job<CreateEmailDto>): Promise<EmailJobResult> {
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
    return { resendId: data?.id };
  }

  /**
   * Marks the corresponding EmailJob PROCESSING once a worker actually
   * picks it up — distinct from it merely sitting QUEUED in Redis.
   * Note: like every other fire-and-forget write in this codebase, a
   * failure here is caught and logged rather than left to reject silently
   * — BullMQ's Worker emits this event via a plain EventEmitter, which
   * never awaits or catches a listener's returned promise. Confirmed via a
   * real Postgres run: an EmailJob can otherwise get permanently stuck out
   * of sync with BullMQ's own (correct) job state, with zero log trail.
   */
  @OnWorkerEvent('active')
  async onActive(job: Job<CreateEmailDto>): Promise<void> {
    if (!job.id) {
      return;
    }
    await this.prisma.emailJob
      .update({ where: { id: job.id }, data: { status: 'PROCESSING' } })
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to sync EmailJob ${job.id} to PROCESSING`,
          error instanceof Error ? error.stack : error,
        );
      });
  }

  /**
   * Marks the corresponding EmailJob SENT once BullMQ confirms the job
   * completed, recording the Resend delivery id returned by process().
   * See onActive's note on why this write is `.catch()`-guarded.
   */
  @OnWorkerEvent('completed')
  async onCompleted(
    job: Job<CreateEmailDto>,
    result: EmailJobResult,
  ): Promise<void> {
    if (!job.id) {
      return;
    }
    await this.prisma.emailJob
      .update({
        where: { id: job.id },
        data: { status: 'SENT', resendId: result.resendId, error: null },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to sync EmailJob ${job.id} to SENT`,
          error instanceof Error ? error.stack : error,
        );
      });
  }

  /**
   * Syncs the corresponding EmailJob when an attempt fails.
   * BullMQ fires this `failed` event on every failed attempt, not just the
   * last one — `job.attemptsMade` vs `job.opts.attempts` tells apart a
   * permanent failure (all attempts exhausted, EmailJob -> FAILED) from one
   * that will still be retried (EmailJob reverted to QUEUED, since it's
   * back in BullMQ's delayed set awaiting its backoff).
   * See onActive's note on why this write is `.catch()`-guarded.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<CreateEmailDto> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job?.id) {
      return;
    }
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    await this.prisma.emailJob
      .update({
        where: { id: job.id },
        data: {
          status: exhausted ? 'FAILED' : 'QUEUED',
          error: error.message,
          attemptsMade: job.attemptsMade,
        },
      })
      .catch((updateError: unknown) => {
        this.logger.error(
          `Failed to sync EmailJob ${job.id} to ${exhausted ? 'FAILED' : 'QUEUED'}`,
          updateError instanceof Error ? updateError.stack : updateError,
        );
      });
  }
}
