import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/** Largest HTML body accepted, in characters (512 KiB). */
export const MAX_HTML_LENGTH = 512 * 1024;
/** Largest plain-text body accepted, in characters (256 KiB). */
export const MAX_TEXT_LENGTH = 256 * 1024;
/** RFC 5322's limit for one header line. */
export const MAX_SUBJECT_LENGTH = 998;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SendEmailDto {
  /** One recipient address. */
  @Transform(trim)
  @IsEmail({}, { message: 'to must be a valid email address' })
  @MaxLength(320)
  to: string;

  @Transform(trim)
  @IsString()
  @Length(1, MAX_SUBJECT_LENGTH)
  // A line break in a header could be used to add other headers (e.g. Bcc).
  @Matches(/^[^\r\n]*$/, { message: 'subject must not contain line breaks' })
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_HTML_LENGTH)
  html: string;

  /** Optional plain-text version for clients that don't show HTML. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT_LENGTH)
  text?: string;
}
