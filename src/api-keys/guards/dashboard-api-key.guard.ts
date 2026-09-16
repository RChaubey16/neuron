import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyService } from '../api-keys.service';
import { ApiKey, User } from '../../../generated/prisma';

@Injectable()
export class DashboardApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  /**
   * Bridges a logged-in dashboard user (attached by a preceding
   * `JwtAuthGuard`) to a service route scoped by `apiKeyId`, by
   * resolving-or-creating that user's hidden system `ApiKey` and attaching
   * it to the request exactly the way `ApiKeyGuard` attaches a real key —
   * so `@CurrentApiKey()`/`UsageLoggingInterceptor`/service methods all work
   * unmodified for a dashboard-originated call.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: User; apiKey?: ApiKey }>();

    request.apiKey = await this.apiKeyService.getOrCreateSystemKey(
      request.user.id,
    );

    return true;
  }
}
