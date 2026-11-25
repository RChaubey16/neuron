import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

const URL_OPTIONS = { require_tld: false, require_protocol: true, protocols: ['http', 'https'] };

/** Splits a comma-separated list of emails into trimmed, lowercase entries. */
export function parseEmailList(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

/**
 * Every environment variable the API reads. The app refuses to start if any of
 * them is invalid, so a misconfigured deploy fails fast instead of half-working.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT: number = 4000;

  @Matches(/^postgres(ql)?:\/\/\S+$/, { message: 'DATABASE_URL must be a postgresql:// URL' })
  DATABASE_URL: string;

  /** Dashboard origin: where sign-in redirects back to, and the only CORS origin allowed. */
  @IsUrl(URL_OPTIONS)
  WEB_URL: string;

  @IsString()
  @IsNotEmpty()
  GOOGLE_CLIENT_ID: string;

  @IsString()
  @IsNotEmpty()
  GOOGLE_CLIENT_SECRET: string;

  /** Must match an authorized redirect URI in the Google Cloud OAuth client. */
  @IsUrl(URL_OPTIONS)
  GOOGLE_CALLBACK_URL: string;

  /** Signs session tokens and cookies. Generate with `openssl rand -base64 48`. */
  @IsString()
  @MinLength(32)
  SESSION_SECRET: string;

  /** Comma-separated Google account emails allowed to sign in. */
  @Transform(({ value }) => parseEmailList(value))
  @ArrayMinSize(1, { message: 'ALLOWED_EMAILS must list at least one email' })
  @IsEmail({}, { each: true, message: 'ALLOWED_EMAILS must contain only valid emails' })
  ALLOWED_EMAILS: string[];

  /**
   * Cookie domain, e.g. `.neuron.example.com`, so the session cookie set by
   * api.neuron.example.com is sent by neuron.example.com. Leave unset locally.
   */
  @IsOptional()
  @Matches(/^\.?[a-z0-9.-]+$/i, { message: 'COOKIE_DOMAIN must be a domain name' })
  COOKIE_DOMAIN?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(env, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return env;
}
