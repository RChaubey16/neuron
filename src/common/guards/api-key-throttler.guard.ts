import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Replaces the default IP-based throttling tracker with one keyed on the
 * caller's API key, so rate limits follow the credential rather than an IP
 * that many unrelated callers behind the same NAT/proxy could share.
 *
 * This is registered globally (`APP_GUARD`) and therefore runs before any
 * route-local `ApiKeyGuard` — `request.apiKey` isn't resolved yet at this
 * point, so the tracker re-hashes the raw `x-api-key` header directly
 * instead of relying on `ApiKeyGuard`'s DB lookup. Requests with no
 * `x-api-key` header (dashboard/auth/health routes, and the public
 * `GET /:code` redirect) fall back to the base class's IP-based tracker.
 */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const rawKey = req.headers['x-api-key'];
    if (typeof rawKey === 'string' && rawKey.length > 0) {
      return `api-key:${createHash('sha256').update(rawKey).digest('hex')}`;
    }
    return super.getTracker(req);
  }
}
