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

  @IsUrl({ protocols: ['https'] })
  SUPABASE_URL: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number;
}

/**
 * Validates `process.env` at startup so a missing/malformed required
 * variable fails fast with a clear message, instead of surfacing later as a
 * cryptic runtime error deep in whichever service first reads it (e.g.
 * `AuthService` previously crashed with `TypeError: Invalid URL` if
 * `SUPABASE_URL` was unset).
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
