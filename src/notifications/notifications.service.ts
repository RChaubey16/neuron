import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmailDto } from './dto/create-email.dto';
import { EmailJobResponseDto } from './dto/email-job-response.dto';
import { EmailJobListResponseDto } from './dto/email-job-list-response.dto';
import { SendTemplatedEmailDto } from './dto/send-templated-email.dto';
import { EmailTemplateSummaryDto } from './dto/email-template-summary.dto';
import { EMAIL_TEMPLATES } from './templates/templates';
import { renderTemplate } from './templates/render-template';
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
   * @param owner - Id of the owning user, plus the ApiKey id when a machine
   *   made the request (omitted for a dashboard-native call)
   * @param dto - Validated recipients/subject/body payload
   * @returns The created job's current state
   */
  async queueEmail(
    owner: { userId: string; apiKeyId?: string },
    dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.createAndQueueJob(owner, dto);
  }

  /**
   * Renders a predefined template with the given variables and queues the
   * result exactly like queueEmail.
   * Throws a NotFoundException if templateKey doesn't match a known
   * template (see `src/notifications/templates/templates.ts`).
   * Throws a BadRequestException (via renderTemplate) if `variables`
   * doesn't exactly match the template's required variables.
   * The rendered subject/body are persisted on the EmailJob row itself,
   * not the template key + raw variables — so status/retry/EmailProcessor
   * need no template-awareness, and editing a template's source later
   * can't retroactively change an already-queued job's content.
   *
   * @param owner - Id of the owning user, plus the ApiKey id when a machine
   *   made the request (omitted for a dashboard-native call)
   * @param templateKey - Key of the template to render, from EMAIL_TEMPLATES
   * @param dto - Recipients and template variable values
   * @returns The created job's current state
   */
  async sendTemplatedEmail(
    owner: { userId: string; apiKeyId?: string },
    templateKey: string,
    dto: SendTemplatedEmailDto,
  ): Promise<EmailJobResponseDto> {
    const template = EMAIL_TEMPLATES[templateKey];
    if (!template) {
      throw new NotFoundException(`Unknown email template '${templateKey}'`);
    }

    const { subject, body } = renderTemplate(template, dto.variables);
    return this.createAndQueueJob(owner, { to: dto.to, subject, body });
  }

  /** Lists the available email templates and the variables each one requires, without exposing their subject/body copy. */
  listTemplates(): EmailTemplateSummaryDto[] {
    return Object.entries(EMAIL_TEMPLATES).map(
      ([key, template]) =>
        new EmailTemplateSummaryDto({
          key,
          requiredVariables: template.requiredVariables,
        }),
    );
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
    const job = await this.findOwnedJob({ apiKeyId }, jobId);
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
    return this.retryJob({ apiKeyId }, jobId);
  }

  /**
   * Re-queues a permanently failed email job owned by the given user, for
   * the dashboard table's retry action — unlike `retry`, which only matches
   * a single calling API key, this spans every job the user owns regardless
   * of which key (or none) created it, matching `findAllForUser`'s scoping.
   * Throws a NotFoundException per the same ownership rule as getStatus.
   * Throws a ConflictException if the job isn't in a FAILED state.
   *
   * @param userId - Id of the dashboard user, for ownership
   * @param jobId - Id of the job to retry
   * @returns The job's state after being re-queued
   */
  async retryForUser(
    userId: string,
    jobId: string,
  ): Promise<EmailJobResponseDto> {
    return this.retryJob({ userId }, jobId);
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
    return this.cancelJob({ apiKeyId }, jobId);
  }

  /**
   * Cancels an email job owned by the given user, for the dashboard table's
   * cancel action — see `retryForUser` for why this scopes differently than
   * `cancel`.
   * Throws a NotFoundException per the same ownership rule as getStatus.
   * Throws a ConflictException if the job is no longer QUEUED.
   *
   * @param userId - Id of the dashboard user, for ownership
   * @param jobId - Id of the job to cancel
   */
  async cancelForUser(userId: string, jobId: string): Promise<void> {
    return this.cancelJob({ userId }, jobId);
  }

  /**
   * Shared retry logic behind `retry` and `retryForUser`, which differ only
   * in how the job's ownership is scoped.
   */
  private async retryJob(
    scope: Prisma.EmailJobWhereInput,
    jobId: string,
  ): Promise<EmailJobResponseDto> {
    const job = await this.findOwnedJob(scope, jobId);
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
   * Shared cancel logic behind `cancel` and `cancelForUser`, which differ
   * only in how the job's ownership is scoped.
   */
  private async cancelJob(
    scope: Prisma.EmailJobWhereInput,
    jobId: string,
  ): Promise<void> {
    const job = await this.findOwnedJob(scope, jobId);
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
   * Lists email jobs owned by the given user, most recently created first,
   * for the dashboard's notifications listing page. Spans every job the
   * user owns regardless of which key (or none) created it.
   *
   * @param userId - Id of the dashboard user
   * @param limit - Max number of rows to return
   * @param offset - Number of rows to skip, for pagination
   * @returns A page of the user's email jobs plus the total matching count
   */
  async findAllForUser(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<EmailJobListResponseDto> {
    return this.listByWhere({ userId }, limit, offset);
  }

  /**
   * Shared pagination/query logic behind `findAllForUser`.
   *
   * @param where - Prisma filter scoping results to the caller
   * @param limit - Max number of rows to return
   * @param offset - Number of rows to skip, for pagination
   * @returns A page of matching email jobs plus the total matching count
   */
  private async listByWhere(
    where: Prisma.EmailJobWhereInput,
    limit: number,
    offset: number,
  ): Promise<EmailJobListResponseDto> {
    const [jobs, total] = await Promise.all([
      this.prisma.emailJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.emailJob.count({ where }),
    ]);

    return new EmailJobListResponseDto({
      items: jobs.map((job) => this.toResponseDto(job)),
      total,
      limit,
      offset,
    });
  }

  /**
   * Creates the durable EmailJob record and queues it for delivery, shared
   * by both a direct send (queueEmail) and a templated send
   * (sendTemplatedEmail) so the two entry points can never drift apart.
   */
  private async createAndQueueJob(
    owner: { userId: string; apiKeyId?: string },
    email: { to: string[]; subject: string; body: string },
  ): Promise<EmailJobResponseDto> {
    const job = await this.prisma.emailJob.create({
      data: {
        userId: owner.userId,
        apiKeyId: owner.apiKeyId,
        to: email.to,
        subject: email.subject,
        body: email.body,
      },
    });

    await this.emailQueue.add('send', email, this.jobOptions(job.id));

    return this.toResponseDto(job);
  }

  /**
   * Finds an EmailJob matching the given ownership scope (either a single
   * `apiKeyId`, for a machine caller, or `{ userId }`, for a dashboard
   * caller acting across every job they own regardless of key).
   * Throws a NotFoundException if no matching job exists — deliberately not
   * distinguishing "doesn't exist" from "exists but isn't owned by this
   * scope", to avoid leaking whether a job id exists under another key.
   */
  private async findOwnedJob(
    scope: Prisma.EmailJobWhereInput,
    jobId: string,
  ): Promise<EmailJob> {
    const job = await this.prisma.emailJob.findFirst({
      where: { id: jobId, ...scope },
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
