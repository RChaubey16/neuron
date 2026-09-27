import { IsUUID } from 'class-validator';

/** Path params for `POST /api-keys/:id/revoke` and `DELETE /api-keys/:id`. */
export class ApiKeyIdParamsDto {
  @IsUUID('4')
  id: string;
}
