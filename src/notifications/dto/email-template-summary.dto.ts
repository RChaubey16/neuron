import { Expose } from 'class-transformer';

/** Shape of an entry in `GET /email/templates` — enough for a caller to know what to send, without exposing the subject/body copy itself. */
export class EmailTemplateSummaryDto {
  @Expose()
  key: string;

  @Expose()
  requiredVariables: string[];

  constructor(
    partial: Pick<EmailTemplateSummaryDto, 'key' | 'requiredVariables'>,
  ) {
    this.key = partial.key;
    this.requiredVariables = partial.requiredVariables;
  }
}
