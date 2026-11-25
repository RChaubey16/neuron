import { createHash, randomBytes } from 'node:crypto';

/** Every key starts with this, so leaked keys are easy to recognise and scan for. */
export const API_KEY_PREFIX = 'nrn_';

/** 32 random bytes, base64url-encoded: 43 characters, 256 bits of entropy. */
const SECRET_BYTES = 32;
const API_KEY_PATTERN = /^nrn_[A-Za-z0-9_-]{43}$/;

/** How much of the key is stored in clear and shown in the dashboard, e.g. `nrn_Ab3dE6gH`. */
export const DISPLAY_PREFIX_LENGTH = 12;

export interface GeneratedApiKey {
  /** The full key. Shown to the user once and never stored. */
  key: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const key = `${API_KEY_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH), hash: hashApiKey(key) };
}

/**
 * SHA-256, hex. A slow hash like bcrypt isn't needed: keys are random with
 * 256 bits of entropy, so they can't be guessed from the hash, and a fast hash
 * lets each request look its key up by an indexed column.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Cheap format check, so malformed keys are rejected without a database query. */
export function isWellFormedApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}
