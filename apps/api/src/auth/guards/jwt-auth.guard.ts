import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator.js';
import type { AuthenticatedRequest } from '@/common/interfaces/auth-user.interface.js';
import { AuthErrorMessage } from '../auth.constants.js';
import { AuthService } from '../auth.service.js';

const BEARER_PATTERN = /^Bearer[ \t]+([^\s]+)[ \t]*$/i;

/** Returns the token from `Authorization: Bearer <token>`, if present. */
export function extractBearerToken(
  header: string | undefined,
): string | undefined {
  return header?.match(BEARER_PATTERN)?.[1];
}

/**
 * Requires a valid Supabase access token in `Authorization: Bearer` and
 * puts the user on `request.user` (read it with `@CurrentUser()`).
 * Routes or controllers marked `@Public()` skip the check.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException(AuthErrorMessage.Missing);
    }

    request.user = await this.auth.verifyAccessToken(token);
    return true;
  }
}
