import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Query params for listing webhook deliveries, optionally narrowed to one endpoint. */
export class WebhookDeliveryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  endpointId?: string;
}
