import { Expose } from 'class-transformer';
import type { WebhookDeliveryStatus } from '../../../generated/prisma';

/** Shape of a `WebhookDelivery` as returned by the delivery log, test and retry routes. */
export class WebhookDeliveryResponseDto {
  @Expose()
  id: string;

  @Expose()
  endpointId: string;

  @Expose()
  eventType: string;

  @Expose()
  payload: unknown;

  @Expose()
  status: WebhookDeliveryStatus;

  @Expose()
  attemptsMade: number;

  @Expose()
  responseStatus: number | null;

  @Expose()
  error: string | null;

  @Expose()
  lastAttemptAt: Date | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  constructor(
    partial: Pick<
      WebhookDeliveryResponseDto,
      | 'id'
      | 'endpointId'
      | 'eventType'
      | 'payload'
      | 'status'
      | 'attemptsMade'
      | 'responseStatus'
      | 'error'
      | 'lastAttemptAt'
      | 'createdAt'
      | 'updatedAt'
    >,
  ) {
    this.id = partial.id;
    this.endpointId = partial.endpointId;
    this.eventType = partial.eventType;
    this.payload = partial.payload;
    this.status = partial.status;
    this.attemptsMade = partial.attemptsMade;
    this.responseStatus = partial.responseStatus;
    this.error = partial.error;
    this.lastAttemptAt = partial.lastAttemptAt;
    this.createdAt = partial.createdAt;
    this.updatedAt = partial.updatedAt;
  }
}
