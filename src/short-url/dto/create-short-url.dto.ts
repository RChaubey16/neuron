import { IsUrl } from 'class-validator';

export class CreateShortUrlDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  originalUrl: string;
}
