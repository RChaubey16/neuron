import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedRequest,
  AuthUser,
} from '@/common/interfaces/auth-user.interface.js';

/**
 * Injects the authenticated user, or one of its fields:
 *
 *     me(@CurrentUser() user: AuthUser)
 *     list(@CurrentUser('id') userId: string)
 *
 * Only valid on routes behind the JWT guard. Using it elsewhere is a
 * programming error and fails the request with a generic 500.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new Error(
        '@CurrentUser() used on a route without an authenticated user',
      );
    }
    return field ? user[field] : user;
  },
);
