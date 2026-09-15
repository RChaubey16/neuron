import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmailDto } from './dto/create-email.dto';
import { EmailJobResponseDto } from './dto/email-job-response.dto';
import type { EmailJob } from '../../generated/prisma';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue<CreateEmailDto>,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Creates a durable `EmailJob` record and queues it for asynchronous
   * delivery, using the record's own id as the BullMQ job id so the two
   * never need reconciling.
   * A downstream Resend failure is EmailProcessor's concern, handled via
   * BullMQ's own retry/backoff on the job, not by this method.
   * Note: if Redis is unreachable, the queue add below does NOT reliably
   * throw — ioredis's offline-queue buffering can cause it to hang instead
   * of failing fast (known gap, not yet fixed; see CLAUDE.md's gotchas).
   * The EmailJob row would be created and left QUEUED in that case.
   *
   * @param apiKeyId - Id of the ApiKey making the request, for ownership
   * @param dto - Validated recipients/subject/body payload
   * @returns The created job's current state
   */
  async queueEmail(
    apiKeyId: string,
    dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    const job = await this.prisma.emailJob.create({
      data: { apiKeyId, to: dto.to, subject: dto.subject, body: dto.body },
    });

    await this.emailQueue.add('send', dto, this.jobOptions(job.id));

    return this.toResponseDto(job);
  }

  /**
   * Looks up an email job's current status.
   * Throws a NotFoundException if the job doesn't exist or isn't owned by
   * the given API key — the two cases are indistinguishable on purpose, to
   * avoid leaking whether a job id exists under another key.
   *
   * @param apiKeyId - Id of the ApiKey making the request, for ownership
   * @param jobId - Id of the job to look up
   * @returns The job's current state
   */
  async getStatus(
    apiKeyId: string,
    jobId: string,
  ): Promise<EmailJobResponseDto> {
    const job = await this.findOwnedJob(apiKeyId, jobId);
    return this.toResponseDto(job);
  }

  /**
   * Re-queues a permanently failed email job from its originally stored
   * payload, resetting its attempt count.
   * Throws a NotFoundException per the same ownership rule as getStatus.
   * Throws a ConflictException if the job isn't in a FAILED state.
   *
   * @param apiKeyId - Id of the ApiKey making the request, for ownership
   * @param jobId - Id of the job to retry
   * @returns The job's state after being re-queued
   */
  async retry(apiKeyId: string, jobId: string): Promise<EmailJobResponseDto> {
    const job = await this.findOwnedJob(apiKeyId, jobId);
    if (job.status !== 'FAILED') {
      throw new ConflictException(`Cannot retry a job in ${job.status} state`);
    }

    const updated = await this.prisma.emailJob.update({
      where: { id: jobId },
      data: { status: 'QUEUED', error: null, attemptsMade: 0 },
    });

    // A previously failed BullMQ job with this same id may still exist in
    // Redis (removeOnFail retains the last 5000) — remove it first so
    // re-adding with the same jobId doesn't collide with it.
    await this.emailQueue.remove(jobId);
    await this.emailQueue.add(
      'send',
      { to: updated.to, subject: updated.subject, body: updated.body },
      this.jobOptions(jobId),
    );

    return this.toResponseDto(updated);
  }

  /**
   * Cancels an email job that hasn't started processing yet.
   * Throws a NotFoundException per the same ownership rule as getStatus.
   * Throws a ConflictException if the job is no longer QUEUED — e.g. it's
   * already being processed, racing this call.
   *
   * @param apiKeyId - Id of the ApiKey making the request, for ownership
   * @param jobId - Id of the job to cancel
   */
  async cancel(apiKeyId: string, jobId: string): Promise<void> {
    const job = await this.findOwnedJob(apiKeyId, jobId);
    if (job.status !== 'QUEUED') {
      throw new ConflictException(`Cannot cancel a job in ${job.status} state`);
    }

    // remove() returns 0 if the job is locked (already picked up by a
    // worker) or already gone — either way it's no longer safely
    // cancellable, so surface that as a conflict rather than a silent no-op.
    const removed = await this.emailQueue.remove(jobId);
    if (removed === 0) {
      throw new ConflictException('Job has already started processing');
    }

    // Guarded by status: 'QUEUED' so a concurrent status change (e.g. the
    // worker marking it PROCESSING between the remove() above and here)
    // can't be silently overwritten back to CANCELLED.
    await this.prisma.emailJob.updateMany({
      where: { id: jobId, status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Finds an EmailJob scoped to the given API key.
   * Throws a NotFoundException if no matching job exists.
   */
  private async findOwnedJob(
    apiKeyId: string,
    jobId: string,
  ): Promise<EmailJob> {
    const job = await this.prisma.emailJob.findFirst({
      where: { id: jobId, apiKeyId },
    });
    if (!job) {
      throw new NotFoundException('Email job not found');
    }
    return job;
  }

  /** Maps an EmailJob Prisma entity to its public response shape. */
  private toResponseDto(job: EmailJob): EmailJobResponseDto {
    return new EmailJobResponseDto({
      id: job.id,
      status: job.status,
      to: job.to,
      subject: job.subject,
      error: job.error,
      attemptsMade: job.attemptsMade,
      resendId: job.resendId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  }

  /** The fixed retry/backoff/retention policy shared by the initial queue and a manual retry, so the two can't drift apart. */
  private jobOptions(jobId: string) {
    return {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 1000, age: 86_400 },
      removeOnFail: { count: 5000 },
      jobId,
    };
  }
}
