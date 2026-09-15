import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsObject,
} from 'class-validator';

export class SendTemplatedEmailDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  to: string[];

  /** Values for the target template's placeholders, keyed by variable name. Validated against the template's `requiredVariables` in NotificationsService.sendTemplatedEmail, not here — the required set differs per template. */
  @IsObject()
  variables: Record<string, string>;
}
