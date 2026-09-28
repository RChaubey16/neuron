import { IsUUID } from 'class-validator';

/** Path params for every `.../webhooks/endpoints/:endpointId` route. */
export class WebhookEndpointParamsDto {
  @IsUUID('4')
  endpointId: string;
}
