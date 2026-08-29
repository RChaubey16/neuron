import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { User } from '../../../generated/prisma';

@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  /** Verifies the request's `Authorization: Bearer <token>` header and attaches the resolved user to the request. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: User }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    request.user = await this.authService.verifyAndSyncUser(token);
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    return header.slice('Bearer '.length);
  }
}
