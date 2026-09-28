import { createHmac, randomBytes } from 'node:crypto';

const SECRET_PREFIX = 'whsec_';

/**
 * Generates an endpoint signing secret in the Standard Webhooks format
 * (`whsec_` + base64 key material), so receivers can pass it straight to an
 * off-the-shelf verification library.
 */
export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(24).toString('base64')}`;
}

/**
 * Computes the `webhook-signature` header value for one delivery attempt,
 * per https://www.standardwebhooks.com/: an HMAC-SHA256 over
 * `${id}.${timestamp}.${body}`, keyed with the secret's base64-decoded
 * bytes (not the `whsec_…` string itself).
 *
 * @param secret - The endpoint's `whsec_…` secret
 * @param id - The delivery id, also sent as `webhook-id`
 * @param timestamp - Unix seconds, also sent as `webhook-timestamp`
 * @param body - The exact request body bytes being sent
 */
export function signWebhook(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
): string {
  const key = Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64');
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return `v1,${signature}`;
}
