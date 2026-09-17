import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { SERVICE_KEY } from '../decorators/service.decorator';
import { ApiKey, User } from '../../../generated/prisma';

@Injectable()
export class UsageLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UsageLoggingInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Writes a UsageLog row for every request handled by a route tagged with
   * @Service(), once either ApiKeyGuard (a machine call) or JwtAuthGuard (a
   * dashboard-native call) has resolved an identity for the request. Runs
   * whether the handler succeeds or throws, and never blocks or fails the
   * request itself.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const service = this.reflector.get<string | undefined>(
      SERVICE_KEY,
      context.getHandler(),
    );
    const request = context.switchToHttp().getRequest<
      Omit<Request, 'route'> & {
        apiKey?: ApiKey;
        user?: User;
        route: { path: string };
      }
    >();

    return next.handle().pipe(
      finalize(() => {
        const userId = request.user?.id ?? request.apiKey?.userId;
        if (!service || !userId) {
          return;
        }

        // Same lazy-PrismaPromise gotcha as ApiKeyGuard's lastUsedAt update:
        // `.catch()` subscribes (triggering execution) without blocking the
        // response; a bare `void` would silently drop the query.
        this.prisma.usageLog
          .create({
            data: {
              userId,
              apiKeyId: request.apiKey?.id ?? null,
              service,
              endpoint: request.route.path,
            },
          })
          .catch((error: unknown) => {
            this.logger.error(
              `Failed to write UsageLog for ${service}/${request.route.path}`,
              error instanceof Error ? error.stack : error,
            );
          });
      }),
    );
  }
}
