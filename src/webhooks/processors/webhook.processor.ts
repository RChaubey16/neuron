import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import type { WebhookDeliveryStatus } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { signWebhook } from '../delivery/signing';
import { BlockedTargetError, checkTargetUrl } from '../delivery/target-guard';
import {
  WEBHOOK_HTTP_CLIENT,
  type WebhookHttpClient,
} from '../delivery/webhook-http-client';
import type { WebhookJobData } from '../providers/webhook-queue.provider';

interface AttemptOutcome {
  status: WebhookDeliveryStatus;
  attemptsMade: number;
  responseStatus: number | null;
  error: string | null;
}

@Processor('webhook')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);
  private readonly allowPrivateTargets: boolean;

  constructor(
    @Inject(WEBHOOK_HTTP_CLIENT) private readonly http: WebhookHttpClient,
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    super();
    this.allowPrivateTargets =
      configService.get<string>('WEBHOOKS_ALLOW_PRIVATE_TARGETS') === 'true';
  }

  /**
   * Makes one delivery attempt: signs the stored payload per Standard
   * Webhooks and POSTs it to the endpoint's current URL, treating any 2xx
   * as success.
   * Throws on any other outcome so BullMQ retries it with backoff — or
   * throws an UnrecoverableError, skipping the remaining attempts, when
   * retrying can't help (endpoint deleted/disabled, or a blocked target).
   * Unlike EmailProcessor, the WebhookDelivery row is updated here rather
   * than from worker events: this is the one place that knows both the
   * HTTP outcome and (via attemptsMade vs. attempts) whether it was the
   * last attempt, and the write is awaited in order, so there's no race
   * between listener writes to guard against.
   * The delivery and endpoint are re-read on every attempt, so a rotated
   * secret or edited URL applies to retries already queued.
   *
   * @param job - BullMQ job carrying the delivery id
   */
  async process(job: Job<WebhookJobData>): Promise<void> {
    const { deliveryId } = job.data;
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery) {
      // Cascade-deleted along with its user — nothing left to deliver.
      this.logger.warn(`WebhookDelivery ${deliveryId} no longer exists`);
      return;
    }

    // attemptsMade counts attempts before this one.
    const attemptsMade = job.attemptsMade + 1;
    const isLastAttempt = attemptsMade >= (job.opts.attempts ?? 1);
    const { endpoint } = delivery;

    const permanentFailure = endpoint.deletedAt
      ? 'Endpoint was deleted'
      : endpoint.disabledAt
        ? 'Endpoint is disabled'
        : checkTargetUrl(endpoint.url, this.allowPrivateTargets);
    if (permanentFailure) {
      await this.recordAttempt(deliveryId, {
        status: 'FAILED',
        attemptsMade,
        responseStatus: null,
        error: permanentFailure,
      });
      throw new UnrecoverableError(permanentFailure);
    }

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      'webhook-id': delivery.id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signWebhook(
        endpoint.secret,
        delivery.id,
        timestamp,
        body,
      ),
    };

    let responseStatus: number;
    try {
      ({ status: responseStatus } = await this.http.post(
        endpoint.url,
        headers,
        body,
        { allowPrivateTargets: this.allowPrivateTargets },
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blocked = error instanceof BlockedTargetError;
      await this.recordAttempt(deliveryId, {
        status: blocked || isLastAttempt ? 'FAILED' : 'PENDING',
        attemptsMade,
        responseStatus: null,
        error: message,
      });
      throw blocked ? new UnrecoverableError(message) : new Error(message);
    }

    if (responseStatus >= 200 && responseStatus < 300) {
      await this.recordAttempt(deliveryId, {
        status: 'SUCCEEDED',
        attemptsMade,
        responseStatus,
        error: null,
      });
      return;
    }

    const message = `Endpoint responded with HTTP ${responseStatus}`;
    await this.recordAttempt(deliveryId, {
      status: isLastAttempt ? 'FAILED' : 'PENDING',
      attemptsMade,
      responseStatus,
      error: message,
    });
    throw new Error(message);
  }

  /**
   * Writes one attempt's outcome to the WebhookDelivery row. A failed write
   * is logged, not rethrown: rethrowing after a successful POST would make
   * BullMQ re-send a webhook the receiver already got.
   */
  private async recordAttempt(
    deliveryId: string,
    outcome: AttemptOutcome,
  ): Promise<void> {
    await this.prisma.webhookDelivery
      .update({
        where: { id: deliveryId },
        data: { ...outcome, lastAttemptAt: new Date() },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to record attempt for WebhookDelivery ${deliveryId}`,
          error instanceof Error ? error.stack : error,
        );
      });
  }
}
