import { Expose } from 'class-transformer';
import { WebhookEndpointResponseDto } from './webhook-endpoint-response.dto';

/** Response for creating an endpoint or rotating its secret — the only times the signing secret is exposed. */
export class WebhookEndpointWithSecretResponseDto extends WebhookEndpointResponseDto {
  @Expose()
  secret: string;

  constructor(
    partial: ConstructorParameters<typeof WebhookEndpointResponseDto>[0] & {
      secret: string;
    },
  ) {
    super(partial);
    this.secret = partial.secret;
  }
}
