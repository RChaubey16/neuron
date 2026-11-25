import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE } from './cookies.js';
import type { AuthenticatedRequest } from './request.js';

/** Allows requests from a signed-in dashboard user (session cookie). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = request.cookies?.[SESSION_COOKIE];

    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Not signed in');
    }

    const user = await this.auth.getUserFromSession(token);
    if (!user) {
      throw new UnauthorizedException('Session is invalid or has expired');
    }

    request.user = user;
    return true;
  }
}
