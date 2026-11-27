import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_QUEUE, SEND_EMAIL_JOB, type SendEmailJobData } from '@neuron/core';
import { type Job, UnrecoverableError } from 'bullmq';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { type DeliveryOutcome, MessageSender } from './message-sender.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks a job's payload. Anything malformed can never succeed, so it isn't retried. */
export function parseJobData(data: unknown): SendEmailJobData {
  if (
    typeof data === 'object' &&
    data !== null &&
    'messageId' in data &&
    typeof data.messageId === 'string' &&
    UUID_PATTERN.test(data.messageId)
  ) {
    return { messageId: data.messageId };
  }
  throw new UnrecoverableError(`Invalid job data: ${JSON.stringify(data)}`);
}

@Processor(EMAIL_QUEUE)
export class SendEmailProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SendEmailProcessor.name);

  constructor(
    private readonly sender: MessageSender,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {
    super();
  }

  /** The worker is created with BullMQ's default concurrency; apply the configured one. */
  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.get('WORKER_CONCURRENCY', { infer: true });
  }

  /**
   * Runs in the last shutdown phase. By then @nestjs/bullmq has closed the
   * worker (in onModuleDestroy), which waits for jobs in progress to finish.
   */
  onApplicationShutdown(signal?: string): void {
    this.logger.log(`Worker stopped${signal ? ` (${signal})` : ''}: jobs in progress finished`);
  }

  /** The return value is stored on the completed job in Redis. */
  async process(job: Job<unknown>): Promise<DeliveryOutcome> {
    if (job.name !== SEND_EMAIL_JOB) {
      throw new UnrecoverableError(`Unknown job name: ${job.name}`);
    }
    const { messageId } = parseJobData(job.data);

    const outcome = await this.sender.deliver(messageId);
    if (outcome.result === 'sent') {
      this.logger.log(`Sent message ${messageId} (provider ID ${outcome.providerMessageId})`);
    } else if (outcome.reason === 'not_found') {
      this.logger.warn(`Skipped message ${messageId}: it no longer exists`);
    } else {
      this.logger.warn(`Skipped message ${messageId}: its status is ${outcome.status}`);
    }
    return outcome;
  }
}
