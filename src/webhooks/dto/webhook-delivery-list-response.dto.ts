import { Expose } from 'class-transformer';
import { WebhookDeliveryResponseDto } from './webhook-delivery-response.dto';

/** Shape of the paginated delivery log response. */
export class WebhookDeliveryListResponseDto {
  @Expose()
  items: WebhookDeliveryResponseDto[];

  @Expose()
  total: number;

  @Expose()
  limit: number;

  @Expose()
  offset: number;

  constructor(
    partial: Pick<
      WebhookDeliveryListResponseDto,
      'items' | 'total' | 'limit' | 'offset'
    >,
  ) {
    this.items = partial.items;
    this.total = partial.total;
    this.limit = partial.limit;
    this.offset = partial.offset;
  }
}
