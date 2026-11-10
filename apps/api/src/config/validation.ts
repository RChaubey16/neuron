import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Environment variables the API reads. Validated once at startup so the
 * app fails fast on bad configuration.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Comma-separated list of origins allowed by CORS (the web app). */
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;
}

/**
 * Used as `ConfigModule.forRoot({ validate })`. Error messages name the
 * failing variables and rules but never include their values, which may be
 * secrets.
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const rules = Object.keys(error.constraints ?? {}).join(', ');
        return `${error.property} (${rules})`;
      })
      .join('; ');
    throw new Error(`Invalid environment variables: ${details}`);
  }

  return validated;
}
