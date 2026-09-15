import { IsNotEmpty, IsString } from 'class-validator';

/** Path param for `POST /email/templates/:templateKey/send`. Not an enum since templates are added over time — an unknown key is resolved (and 404'd) by NotificationsService, not by validation. */
export class TemplateKeyParamsDto {
  @IsString()
  @IsNotEmpty()
  templateKey: string;
}
