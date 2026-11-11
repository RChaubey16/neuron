import type { Request } from 'express';

/**
 * The signed-in user, taken from a verified Supabase access token.
 * `fullName` and `avatarUrl` come from Google via `user_metadata`, which
 * the user can change, so treat them as display data only.
 */
export interface AuthUser {
  /** Supabase user ID (`auth.users.id`, the token's `sub`). */
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
}

/** A request that has passed the JWT guard. */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
