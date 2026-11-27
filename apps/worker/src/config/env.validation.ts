import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/** Which EmailProvider sends email: SMTP (Mailpit locally) or Resend (production). */
export enum EmailProviderName {
  Smtp = 'smtp',
  Resend = 'resend',
}

const isSmtp = (env: EnvironmentVariables) => env.EMAIL_PROVIDER === EmailProviderName.Smtp;
const isResend = (env: EnvironmentVariables) => env.EMAIL_PROVIDER === EmailProviderName.Resend;

function parseBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/**
 * Every environment variable the worker reads. It refuses to start if any is
 * invalid, so a misconfigured deploy fails fast instead of failing every email.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Matches(/^postgres(ql)?:\/\/\S+$/, { message: 'DATABASE_URL must be a postgresql:// URL' })
  DATABASE_URL: string;

  @Matches(/^rediss?:\/\/\S+$/, { message: 'REDIS_URL must be a redis:// or rediss:// URL' })
  REDIS_URL: string;

  /** How many emails one worker process sends at the same time. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  WORKER_CONCURRENCY: number = 5;

  /** Port of the worker's health check (GET /health), used by Docker and Coolify. Not public. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  WORKER_HEALTH_PORT: number = 4001;

  @IsEnum(EmailProviderName)
  EMAIL_PROVIDER: EmailProviderName = EmailProviderName.Smtp;

  // --- Resend (EMAIL_PROVIDER=resend). ---

  @ValidateIf(isResend)
  @Matches(/^re_\S+$/, {
    message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend and must start with re_',
  })
  RESEND_API_KEY?: string;

  // --- SMTP (EMAIL_PROVIDER=smtp). Locally this is Mailpit. ---

  @ValidateIf(isSmtp)
  @IsString()
  @MinLength(1)
  SMTP_HOST: string = 'localhost';

  @ValidateIf(isSmtp)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number = 1025;

  /** true for implicit TLS (usually port 465). STARTTLS is used automatically when offered. */
  @ValidateIf(isSmtp)
  @Transform(parseBoolean)
  @IsBoolean()
  SMTP_SECURE: boolean = false;

  /** Set both SMTP_USER and SMTP_PASSWORD, or neither (Mailpit needs no login). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  SMTP_USER?: string;

  @ValidateIf((env: EnvironmentVariables) => env.SMTP_USER !== undefined)
  @IsString()
  @MinLength(1, { message: 'SMTP_PASSWORD is required when SMTP_USER is set' })
  SMTP_PASSWORD?: string;
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
