import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator, InternalServerErrorException } from '@nestjs/common';
import type { ApiKey } from '@neuron/db';
import type { AuthenticatedRequest } from '../auth/request.js';

/** The API key identified by ApiKeyGuard. */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApiKey => {
    const apiKey = context.switchToHttp().getRequest<AuthenticatedRequest>().apiKey;
    if (!apiKey) {
      throw new InternalServerErrorException('Route is missing ApiKeyGuard');
    }
    return apiKey;
  },
);
