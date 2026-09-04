import { createHash } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKey } from '../../../generated/prisma';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifies the request's `x-api-key` header against stored key hashes and
   * attaches the resolved `ApiKey` to the request.
   * Throws an UnauthorizedException if the header is missing or doesn't
   * match an active (non-revoked) key.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { apiKey?: ApiKey }>();
    const rawKey = request.headers['x-api-key'];
    if (typeof rawKey !== 'string' || rawKey.length === 0) {
      throw new UnauthorizedException('Missing x-api-key header');
    }

    const hashedKey = createHash('sha256').update(rawKey).digest('hex');
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { hashedKey, revokedAt: null },
    });
    if (!apiKey) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    request.apiKey = apiKey;
    // Fire-and-forget: a slow/failed usage-timestamp update shouldn't delay
    // or break the actual request. Prisma query builders are lazy
    // "PrismaPromise"s that only execute once something subscribes via
    // `.then()`/`.catch()` — `void` alone would discard the reference
    // without ever triggering the query.
    this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to update lastUsedAt for API key ${apiKey.id}`,
          error instanceof Error ? error.stack : error,
        );
      });

    return true;
  }
}
