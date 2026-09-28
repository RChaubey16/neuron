import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Prisma } from '../../generated/prisma';
import type { WebhookDelivery, WebhookEndpoint } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { WebhookDeliveryQueryDto } from './dto/webhook-delivery-query.dto';
import { WebhookEndpointResponseDto } from './dto/webhook-endpoint-response.dto';
import { WebhookEndpointWithSecretResponseDto } from './dto/webhook-endpoint-with-secret-response.dto';
import { WebhookDeliveryResponseDto } from './dto/webhook-delivery-response.dto';
import { WebhookDeliveryListResponseDto } from './dto/webhook-delivery-list-response.dto';
import { generateWebhookSecret } from './delivery/signing';
import { checkTargetUrl } from './delivery/target-guard';
import {
  WEBHOOK_QUEUE,
  type WebhookJobData,
} from './providers/webhook-queue.provider';
import {
  WEBHOOK_TEST_EVENT,
  type SubscribableWebhookEvent,
  type WebhookEventType,
} from './webhook-events';

export const MAX_ENDPOINTS_PER_USER = 10;

const QUEUEING_FAILED_ERROR = 'Could not be queued for delivery';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly allowPrivateTargets: boolean;

  constructor(
    @Inject(WEBHOOK_QUEUE) private readonly webhookQueue: Queue<WebhookJobData>,
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.allowPrivateTargets =
      configService.get<string>('WEBHOOKS_ALLOW_PRIVATE_TARGETS') === 'true';
  }

  /**
   * Registers a new webhook endpoint for the user with a freshly generated
   * signing secret.
   * Throws a BadRequestException if the URL isn't an allowed target (see
   * checkTargetUrl), or a ConflictException if the user already has
   * MAX_ENDPOINTS_PER_USER live endpoints.
   *
   * @param userId - Id of the owning user
   * @param dto - Validated url/description/events payload
   * @returns The created endpoint, including its secret — the only time
   *   besides rotateSecret that it's ever returned
   */
  async createEndpoint(
    userId: string,
    dto: CreateWebhookEndpointDto,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    this.assertAllowedUrl(dto.url);

    const liveCount = await this.prisma.webhookEndpoint.count({
      where: { userId, deletedAt: null },
    });
    if (liveCount >= MAX_ENDPOINTS_PER_USER) {
      throw new ConflictException(
        `You can register at most ${MAX_ENDPOINTS_PER_USER} webhook endpoints`,
      );
    }

    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        userId,
        url: dto.url,
        description: dto.description,
        events: dto.events,
        secret: generateWebhookSecret(),
      },
    });
    return this.toEndpointWithSecretDto(endpoint);
  }

  /**
   * Lists the user's live (not deleted) endpoints, newest first.
   *
   * @param userId - Id of the owning user
   */
  async listEndpoints(userId: string): Promise<WebhookEndpointResponseDto[]> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return endpoints.map((endpoint) => this.toEndpointDto(endpoint));
  }

  /**
   * Looks up one of the user's endpoints.
   * Throws a NotFoundException if it doesn't exist, is deleted, or belongs
   * to another user.
   *
   * @param userId - Id of the owning user
   * @param endpointId - Id of the endpoint
   */
  async getEndpoint(
    userId: string,
    endpointId: string,
  ): Promise<WebhookEndpointResponseDto> {
    const endpoint = await this.findOwnedEndpoint(userId, endpointId);
    return this.toEndpointDto(endpoint);
  }

  /**
   * Updates an endpoint's url, description, subscribed events, or enabled
   * state. Disabling it makes any delivery still awaiting a retry fail on
   * its next attempt (see WebhookProcessor).
   * Throws a NotFoundException per getEndpoint's ownership rule, or a
   * BadRequestException if a new URL isn't an allowed target.
   *
   * @param userId - Id of the owning user
   * @param endpointId - Id of the endpoint
   * @param dto - Fields to change; omitted fields are left as they are
   * @returns The updated endpoint
   */
  async updateEndpoint(
    userId: string,
    endpointId: string,
    dto: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpointResponseDto> {
    const endpoint = await this.findOwnedEndpoint(userId, endpointId);
    if (dto.url !== undefined) {
      this.assertAllowedUrl(dto.url);
    }

    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        url: dto.url,
        description: dto.description,
        events: dto.events,
        // Keep an existing disabledAt timestamp rather than bumping it when
        // an already-disabled endpoint is "disabled" again.
        disabledAt:
          dto.enabled === undefined
            ? undefined
            : dto.enabled
              ? null
              : (endpoint.disabledAt ?? new Date()),
      },
    });
    return this.toEndpointDto(updated);
  }

  /**
   * Soft-deletes an endpoint, so it stops receiving events but its
   * delivery history stays intact.
   * Throws a NotFoundException per getEndpoint's ownership rule.
   *
   * @param userId - Id of the owning user
   * @param endpointId - Id of the endpoint
   */
  async deleteEndpoint(userId: string, endpointId: string): Promise<void> {
    const endpoint = await this.findOwnedEndpoint(userId, endpointId);
    await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Replaces an endpoint's signing secret. Takes effect from the next
   * delivery attempt, including retries of deliveries already queued.
   * Throws a NotFoundException per getEndpoint's ownership rule.
   *
   * @param userId - Id of the owning user
   * @param endpointId - Id of the endpoint
   * @returns The endpoint with its new secret
   */
  async rotateSecret(
    userId: string,
    endpointId: string,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    const endpoint = await this.findOwnedEndpoint(userId, endpointId);
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { secret: generateWebhookSecret() },
    });
    return this.toEndpointWithSecretDto(updated);
  }

  /**
   * Queues a `webhook.test` delivery to one endpoint, whether or not it's
   * subscribed to anything, so the owner can check their receiver works.
   * Throws a NotFoundException per getEndpoint's ownership rule, or a
   * ConflictException if the endpoint is disabled (the delivery would only
   * fail).
   * Throws a ServiceUnavailableException if it couldn't be queued; the
   * delivery row is left FAILED and retryable.
   *
   * @param userId - Id of the owning user
   * @param endpointId - Id of the endpoint
   * @returns The queued delivery
   */
  async sendTestEvent(
    userId: string,
    endpointId: string,
  ): Promise<WebhookDeliveryResponseDto> {
    const endpoint = await this.findOwnedEndpoint(userId, endpointId);
    if (endpoint.disabledAt) {
      throw new ConflictException('Enable the endpoint to send it events');
    }

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        id: randomUUID(),
        endpointId: endpoint.id,
        userId,
        eventType: WEBHOOK_TEST_EVENT,
        payload: this.buildPayload(WEBHOOK_TEST_EVENT, {
          endpointId: endpoint.id,
          message: 'This is a test event from Neuron.',
        }),
      },
    });

    if (!(await this.enqueue([delivery.id]))) {
      throw new ServiceUnavailableException(
        'Test event could not be queued right now, please try again',
      );
    }
    return this.toDeliveryDto(delivery);
  }

  /**
   * Lists the user's deliveries, newest first, optionally narrowed to one
   * endpoint (including a deleted one, so its history stays browsable).
   *
   * @param userId - Id of the owning user
   * @param query - Pagination plus an optional endpointId filter
   * @returns A page of deliveries plus the total matching count
   */
  async listDeliveries(
    userId: string,
    query: WebhookDeliveryQueryDto,
  ): Promise<WebhookDeliveryListResponseDto> {
    const where: Prisma.WebhookDeliveryWhereInput = {
      userId,
      endpointId: query.endpointId,
    };
    const [deliveries, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);

    return new WebhookDeliveryListResponseDto({
      items: deliveries.map((delivery) => this.toDeliveryDto(delivery)),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Re-queues a FAILED delivery with a fresh set of attempts. It keeps its
   * id — and so its `webhook-id` — since it's the same message, which lets
   * a receiver that did get an earlier attempt dedupe it.
   * Throws a NotFoundException if the delivery doesn't exist or isn't the
   * user's, a ConflictException if it isn't FAILED, a concurrent retry got
   * there first, or its endpoint is deleted or disabled, and a
   * ServiceUnavailableException if it couldn't be re-queued.
   *
   * @param userId - Id of the owning user
   * @param deliveryId - Id of the delivery to retry
   * @returns The delivery after being re-queued
   */
  async retryDelivery(
    userId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryResponseDto> {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, userId },
      include: { endpoint: true },
    });
    if (!delivery) {
      throw new NotFoundException('Webhook delivery not found');
    }
    if (delivery.status !== 'FAILED') {
      throw new ConflictException(
        `Cannot retry a delivery in ${delivery.status} state`,
      );
    }
    if (delivery.endpoint.deletedAt || delivery.endpoint.disabledAt) {
      throw new ConflictException(
        'Cannot retry a delivery to a deleted or disabled endpoint',
      );
    }

    // Guarded by status: 'FAILED' so two concurrent retries can't both pass
    // the check above and queue the delivery twice.
    const updated = await this.prisma.webhookDelivery
      .update({
        where: { id: deliveryId, status: 'FAILED' },
        data: { status: 'PENDING', error: null, attemptsMade: 0 },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new ConflictException('Delivery is already being retried');
        }
        throw error;
      });

    // The failed BullMQ job with this id may still be retained in Redis
    // (removeOnFail), which would make re-adding it with the same jobId a
    // silent no-op — remove it first.
    let queued = false;
    try {
      await this.webhookQueue.remove(deliveryId);
      queued = await this.enqueue([deliveryId]);
    } catch (error) {
      this.logger.error(
        `Failed to remove old job for WebhookDelivery ${deliveryId}`,
        error instanceof Error ? error.stack : error,
      );
      await this.markQueueingFailed([deliveryId]);
    }
    if (!queued) {
      throw new ServiceUnavailableException(
        'Delivery could not be queued right now, please try again',
      );
    }
    return this.toDeliveryDto(updated);
  }

  /**
   * Fans an event out to every enabled endpoint of the user subscribed to
   * it: one WebhookDelivery row and one queued job per endpoint.
   * Never throws — it's called from other modules' state-change paths
   * (e.g. EmailProcessor), which must not break because of webhooks. Any
   * failure is logged; deliveries that couldn't be queued are marked
   * FAILED so they can be retried.
   *
   * @param userId - Id of the user whose event this is
   * @param type - The event type
   * @param data - The event's `data` object, already JSON-safe
   */
  async emit(
    userId: string,
    type: SubscribableWebhookEvent,
    data: Prisma.InputJsonObject,
  ): Promise<void> {
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: {
          userId,
          deletedAt: null,
          disabledAt: null,
          events: { has: type },
        },
        select: { id: true },
      });
      if (endpoints.length === 0) {
        return;
      }

      // Every endpoint gets the identical payload (same timestamp), and
      // ids are generated here rather than by Prisma so createMany — which
      // doesn't return rows — still gives us the job ids to queue.
      const payload = this.buildPayload(type, data);
      const deliveries = endpoints.map((endpoint) => ({
        id: randomUUID(),
        endpointId: endpoint.id,
        userId,
        eventType: type,
        payload,
      }));
      await this.prisma.webhookDelivery.createMany({ data: deliveries });
      await this.enqueue(deliveries.map((delivery) => delivery.id));
    } catch (error) {
      this.logger.error(
        `Failed to emit ${type} webhooks for user ${userId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Queues one job per delivery id. On failure, marks those deliveries
   * FAILED instead of leaving them PENDING forever with no job behind them.
   *
   * @returns Whether the jobs were queued
   */
  private async enqueue(deliveryIds: string[]): Promise<boolean> {
    try {
      await this.webhookQueue.addBulk(
        deliveryIds.map((deliveryId) => ({
          name: 'deliver',
          data: { deliveryId },
          opts: this.jobOptions(deliveryId),
        })),
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to queue WebhookDeliveries ${deliveryIds.join(', ')}`,
        error instanceof Error ? error.stack : error,
      );
      await this.markQueueingFailed(deliveryIds);
      return false;
    }
  }

  /** Marks deliveries that never made it onto the queue as FAILED, so they show up as retryable. Never throws. */
  private async markQueueingFailed(deliveryIds: string[]): Promise<void> {
    await this.prisma.webhookDelivery
      .updateMany({
        where: { id: { in: deliveryIds } },
        data: { status: 'FAILED', error: QUEUEING_FAILED_ERROR },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to mark WebhookDeliveries ${deliveryIds.join(', ')} as FAILED after a queueing error`,
          error instanceof Error ? error.stack : error,
        );
      });
  }

  /**
   * Throws a BadRequestException if the URL isn't an allowed webhook
   * target. This is the cheap syntactic check; WebhookProcessor re-checks
   * at delivery time and also validates the resolved address.
   */
  private assertAllowedUrl(url: string): void {
    const reason = checkTargetUrl(url, this.allowPrivateTargets);
    if (reason) {
      throw new BadRequestException(reason);
    }
  }

  /**
   * Finds a live endpoint owned by the user.
   * Throws a NotFoundException otherwise — not distinguishing "doesn't
   * exist" from "belongs to someone else", to avoid leaking which ids
   * exist.
   */
  private async findOwnedEndpoint(
    userId: string,
    endpointId: string,
  ): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, userId, deletedAt: null },
    });
    if (!endpoint) {
      throw new NotFoundException('Webhook endpoint not found');
    }
    return endpoint;
  }

  /** Wraps event data in the envelope every webhook body shares. */
  private buildPayload(
    type: WebhookEventType,
    data: Prisma.InputJsonObject,
  ): Prisma.InputJsonObject {
    return { type, timestamp: new Date().toISOString(), data };
  }

  /** Maps a WebhookEndpoint entity to its public shape, without the secret. */
  private toEndpointDto(endpoint: WebhookEndpoint): WebhookEndpointResponseDto {
    return new WebhookEndpointResponseDto({
      id: endpoint.id,
      url: endpoint.url,
      description: endpoint.description,
      events: endpoint.events,
      enabled: endpoint.disabledAt === null,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    });
  }

  /** Maps a WebhookEndpoint entity to its public shape including the secret, for create/rotate only. */
  private toEndpointWithSecretDto(
    endpoint: WebhookEndpoint,
  ): WebhookEndpointWithSecretResponseDto {
    return new WebhookEndpointWithSecretResponseDto({
      ...this.toEndpointDto(endpoint),
      secret: endpoint.secret,
    });
  }

  /** Maps a WebhookDelivery entity to its public shape. */
  private toDeliveryDto(delivery: WebhookDelivery): WebhookDeliveryResponseDto {
    return new WebhookDeliveryResponseDto({
      id: delivery.id,
      endpointId: delivery.endpointId,
      eventType: delivery.eventType,
      payload: delivery.payload,
      status: delivery.status,
      attemptsMade: delivery.attemptsMade,
      responseStatus: delivery.responseStatus,
      error: delivery.error,
      lastAttemptAt: delivery.lastAttemptAt,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
    });
  }

  /**
   * The retry/backoff/retention policy shared by the first queueing and a
   * manual retry: 6 attempts, backing off 30s, 1m, 2m, 4m, 8m.
   */
  private jobOptions(deliveryId: string) {
    return {
      attempts: 6,
      backoff: { type: 'exponential' as const, delay: 30_000 },
      removeOnComplete: { count: 1000, age: 86_400 },
      removeOnFail: { count: 5000 },
      jobId: deliveryId,
    };
  }
}
