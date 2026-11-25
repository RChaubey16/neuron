import type { CookieOptions } from 'express';
import { NodeEnv, type EnvironmentVariables } from '../config/env.validation.js';

export const SESSION_COOKIE = 'neuron_session';
export const OAUTH_COOKIE = 'neuron_oauth';

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;

type CookieEnv = Pick<EnvironmentVariables, 'NODE_ENV' | 'COOKIE_DOMAIN'>;

function baseOptions(env: CookieEnv): CookieOptions {
  return {
    httpOnly: true,
    // Plain http on localhost; HTTPS everywhere else.
    secure: env.NODE_ENV === NodeEnv.Production,
    // Sent on top-level navigations (Google's redirect back) and same-site
    // requests from the dashboard, never on cross-site POSTs.
    sameSite: 'lax',
  };
}

/** The signed-in session, shared with the dashboard through COOKIE_DOMAIN. */
export function sessionCookieOptions(env: CookieEnv): CookieOptions {
  return {
    ...baseOptions(env),
    domain: env.COOKIE_DOMAIN,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

/**
 * Holds the OAuth state and PKCE verifier between the redirect to Google and
 * the callback. Signed so it can't be tampered with, and scoped to /auth/google.
 */
export function oauthCookieOptions(env: CookieEnv): CookieOptions {
  return {
    ...baseOptions(env),
    signed: true,
    path: '/auth/google',
    maxAge: OAUTH_TTL_SECONDS * 1000,
  };
}

/** Options for clearCookie: the same domain and path, without maxAge. */
export function clearOptions(options: CookieOptions): CookieOptions {
  const cleared = { ...options };
  delete cleared.maxAge;
  return cleared;
}
