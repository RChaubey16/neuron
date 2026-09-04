import { IsUUID } from 'class-validator';

/** Path params for `DELETE /api-keys/:id`. */
export class RevokeApiKeyParamsDto {
  @IsUUID('4')
  id: string;
}
