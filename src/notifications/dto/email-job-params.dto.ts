import { IsUUID } from 'class-validator';

/** Path params for `GET /email/:jobId`, `POST /email/:jobId/retry`, and `DELETE /email/:jobId`. */
export class EmailJobParamsDto {
  @IsUUID('4')
  jobId: string;
}
