import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ApiKey } from '../../../generated/prisma';

/** Extracts the `ApiKey` attached to the request by `ApiKeyGuard`. */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKey => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { apiKey: ApiKey }>();
    return request.apiKey;
  },
);
