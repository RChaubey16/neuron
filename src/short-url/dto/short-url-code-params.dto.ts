import { Matches } from 'class-validator';
import { CODE_LENGTH } from '../short-url.service';

/** Path params for `GET /:code`. Matches nanoid's default URL-safe alphabet. */
export class ShortUrlCodeParamsDto {
  @Matches(new RegExp(`^[A-Za-z0-9_-]{${CODE_LENGTH}}$`))
  code: string;
}
