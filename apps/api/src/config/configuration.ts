import { NodeEnv } from './validation.js';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  database: {
    url: string;
  };
  cors: {
    origins: string[];
  };
  auth: {
    /** Expected `iss` claim of Supabase access tokens. */
    issuer: string;
    /** Supabase's public signing keys (JWKS) for those tokens. */
    jwksUrl: string;
    /** Expected `aud` claim: signed-in (non-anonymous-role) users. */
    audience: string;
  };
}

export function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Supabase Auth endpoints derived from the project URL. */
export function supabaseAuthUrls(supabaseUrl: string): {
  issuer: string;
  jwksUrl: string;
} {
  const issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  return { issuer, jwksUrl: `${issuer}/.well-known/jwks.json` };
}

/**
 * Typed configuration built from validated environment variables.
 * Read it with `ConfigService<AppConfig, true>`.
 */
export default (): AppConfig => ({
  nodeEnv: (process.env.NODE_ENV as NodeEnv | undefined) ?? NodeEnv.Development,
  port: Number(process.env.PORT ?? 3000),
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  cors: {
    origins: parseList(process.env.CORS_ORIGINS),
  },
  auth: {
    ...supabaseAuthUrls(process.env.SUPABASE_URL ?? ''),
    audience: 'authenticated',
  },
});
