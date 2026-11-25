import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/request.js';
import { ApiKeysService } from './api-keys.service.js';

const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i;

/** Allows requests to the public API that send a valid `Authorization: Bearer <key>`. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const header = request.headers.authorization;
    const rawKey = header ? BEARER_PATTERN.exec(header)?.[1] : undefined;

    if (!rawKey) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException('Missing API key. Send it as "Authorization: Bearer <key>".');
    }

    const authenticated = await this.apiKeys.authenticate(rawKey);
    if (!authenticated) {
      response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    request.apiKey = authenticated.apiKey;
    request.user = authenticated.user;
    return true;
  }
}
