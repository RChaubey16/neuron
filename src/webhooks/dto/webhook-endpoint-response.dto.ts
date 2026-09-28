import { Expose } from 'class-transformer';

/** Shape of a `WebhookEndpoint` as returned by list/get/update — never includes the signing secret. */
export class WebhookEndpointResponseDto {
  @Expose()
  id: string;

  @Expose()
  url: string;

  @Expose()
  description: string | null;

  @Expose()
  events: string[];

  @Expose()
  enabled: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  constructor(
    partial: Pick<
      WebhookEndpointResponseDto,
      | 'id'
      | 'url'
      | 'description'
      | 'events'
      | 'enabled'
      | 'createdAt'
      | 'updatedAt'
    >,
  ) {
    this.id = partial.id;
    this.url = partial.url;
    this.description = partial.description;
    this.events = partial.events;
    this.enabled = partial.enabled;
    this.createdAt = partial.createdAt;
    this.updatedAt = partial.updatedAt;
  }
}
