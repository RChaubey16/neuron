import { IsUUID } from 'class-validator';

/** Path params for `.../webhooks/deliveries/:deliveryId/retry`. */
export class WebhookDeliveryParamsDto {
  @IsUUID('4')
  deliveryId: string;
}
