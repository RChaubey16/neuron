/**
 * Injection token for the key set used to verify Supabase access tokens.
 * In production it fetches and caches the project's JWKS; tests replace it
 * with a local key set.
 */
export const SUPABASE_JWKS = Symbol('SUPABASE_JWKS');

/** Only asymmetric algorithms: the API never holds a JWT secret. */
export const ACCEPTED_JWT_ALGORITHMS = ['ES256', 'RS256'];

/** Allowed clock difference between Supabase and this server. */
export const JWT_CLOCK_TOLERANCE_SECONDS = 5;

/** Client-facing 401/503 messages. They never include token details. */
export const AuthErrorMessage = {
  Missing: 'Missing bearer token',
  Invalid: 'Invalid access token',
  Expired: 'Access token has expired',
  Unavailable: 'Authentication is temporarily unavailable',
} as const;
