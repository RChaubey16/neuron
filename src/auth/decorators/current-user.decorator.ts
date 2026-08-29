import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../../../generated/prisma';

/** Extracts the `User` attached to the request by `SupabaseJwtGuard`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<Request & { user: User }>();
    return request.user;
  },
);
