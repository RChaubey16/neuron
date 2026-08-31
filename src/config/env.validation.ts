import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsString()
  DATABASE_URL: string;

  @IsString()
  GOOGLE_CLIENT_ID: string;

  @IsString()
  GOOGLE_CLIENT_SECRET: string;

  @IsUrl({ protocols: ['http', 'https'], require_tld: false, require_protocol: true })
  GOOGLE_CALLBACK_URL: string;

  @IsString()
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;

  @IsUrl({ protocols: ['http', 'https'], require_tld: false, require_protocol: true })
  FRONTEND_URL: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number;
}

/**
 * Validates `process.env` at startup so a missing/malformed required
 * variable fails fast with a clear message, instead of surfacing later as a
 * cryptic runtime error deep in whichever service first reads it.
 *
 * @param config - Raw environment variables, as passed by `ConfigModule`
 * @returns The validated, type-coerced configuration
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }
  return validated;
}
