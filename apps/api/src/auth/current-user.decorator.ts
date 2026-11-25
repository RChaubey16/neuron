import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator, InternalServerErrorException } from '@nestjs/common';
import type { User } from '@neuron/db';
import type { AuthenticatedRequest } from './request.js';

/** The user identified by SessionGuard or ApiKeyGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) {
      // Only reachable if a route uses @CurrentUser() without a guard.
      throw new InternalServerErrorException('Route is missing an authentication guard');
    }
    return user;
  },
);
