import { Expose } from 'class-transformer';

/** Shape of an entry in the dashboard's `GET /notifications/templates` — unlike EmailTemplateSummaryDto, this exposes the rendered subject/body so a human can preview the template before using it. */
export class EmailTemplatePreviewDto {
  @Expose()
  key: string;

  @Expose()
  subject: string;

  @Expose()
  body: string;

  @Expose()
  requiredVariables: string[];

  @Expose()
  urlVariables: string[];

  constructor(
    partial: Pick<
      EmailTemplatePreviewDto,
      'key' | 'subject' | 'body' | 'requiredVariables' | 'urlVariables'
    >,
  ) {
    this.key = partial.key;
    this.subject = partial.subject;
    this.body = partial.body;
    this.requiredVariables = partial.requiredVariables;
    this.urlVariables = partial.urlVariables;
  }
}
