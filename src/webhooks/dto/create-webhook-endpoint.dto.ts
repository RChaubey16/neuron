import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import {
  SUBSCRIBABLE_WEBHOOK_EVENTS,
  type SubscribableWebhookEvent,
} from '../webhook-events';

/**
 * Request body for creating a webhook endpoint. `url` only gets a syntax
 * check here — the https/private-host rules live in `checkTargetUrl`,
 * since they depend on `WEBHOOKS_ALLOW_PRIVATE_TARGETS`.
 */
export class CreateWebhookEndpointDto {
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(2048)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(SUBSCRIBABLE_WEBHOOK_EVENTS, { each: true })
  events: SubscribableWebhookEvent[];
}
