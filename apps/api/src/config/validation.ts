import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
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

  /**
   * Runtime database connection (Supabase transaction pooler, port 6543).
   * Prisma Migrate uses DIRECT_URL instead; see prisma.config.ts.
   */
  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  })
  DATABASE_URL: string;

  /**
   * Supabase project URL, e.g. https://<project-ref>.supabase.co. Used to
   * verify login tokens (issuer and public signing keys). Not a secret.
   */
  @IsUrl(
    {
      require_tld: false,
      require_protocol: true,
      protocols: ['http', 'https'],
    },
    { message: 'SUPABASE_URL must be an http(s) URL' },
  )
  SUPABASE_URL: string;

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
