import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
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

/** Request body for updating a webhook endpoint. Every field is optional; `description: null` clears it. */
export class UpdateWebhookEndpointDto {
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(SUBSCRIBABLE_WEBHOOK_EVENTS, { each: true })
  events?: SubscribableWebhookEvent[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
