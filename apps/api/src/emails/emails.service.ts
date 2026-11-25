import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_QUEUE, SEND_EMAIL_JOB, type SendEmailJobData } from '@neuron/core';
import type { ApiKey } from '@neuron/db';
import { MessageStatus } from '@neuron/db';
import { Queue } from 'bullmq';
import { withTimeout } from '../common/with-timeout.js';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SendEmailDto } from './send-email.dto.js';

/** How long to wait for Redis to accept a job before giving up on the request. */
export const ENQUEUE_TIMEOUT_MS = 5_000;

export interface SendEmailResponse {
  id: string;
  status: typeof MessageStatus.queued;
}

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);
  private readonly from: string;
  /** How long to wait for Redis to accept a job. A field so tests can shorten it. */
  enqueueTimeoutMs = ENQUEUE_TIMEOUT_MS;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<SendEmailJobData>,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.from = config.get('EMAIL_FROM', { infer: true });
  }

  /**
   * Records the message, then queues it for the worker. The message is written
   * first so it exists (and has an ID) before any worker can pick up the job.
   *
   * If the job can't be queued, the message is marked failed and the client
   * gets a 503 to retry, rather than a 202 for an email that will never send.
   */
  async send(apiKey: ApiKey, input: SendEmailDto): Promise<SendEmailResponse> {
    const message = await this.prisma.message.create({
      data: {
        userId: apiKey.userId,
        apiKeyId: apiKey.id,
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text ?? null,
        status: MessageStatus.queued,
      },
    });

    try {
      await withTimeout(
        // jobId = message ID: BullMQ ignores a second job with the same ID.
        this.queue.add(SEND_EMAIL_JOB, { messageId: message.id }, { jobId: message.id }),
        this.enqueueTimeoutMs,
        'Adding the email job',
      );
    } catch (error) {
      this.logger.error(`Could not queue message ${message.id}: ${String(error)}`);
      await this.markUnqueued(message.id, error);
      throw new ServiceUnavailableException(
        'The email queue is unavailable, so the email was not sent. Try again shortly.',
      );
    }

    return { id: message.id, status: MessageStatus.queued };
  }

  private async markUnqueued(id: string, error: unknown): Promise<void> {
    try {
      await this.prisma.message.update({
        where: { id },
        data: { status: MessageStatus.failed, lastError: `Could not be queued: ${String(error)}` },
      });
    } catch (updateError) {
      // The request still fails with 503; this only loses the failure reason.
      this.logger.error(`Could not mark message ${id} as failed: ${String(updateError)}`);
    }
  }
}
