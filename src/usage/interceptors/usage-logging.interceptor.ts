import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { SERVICE_KEY } from '../decorators/service.decorator';
import { ApiKey } from '../../../generated/prisma';

@Injectable()
export class UsageLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Writes a UsageLog row for every request handled by a route tagged with
   * @Service(), once ApiKeyGuard has resolved the caller's ApiKey. Runs
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
        route: { path: string };
      }
    >();

    return next.handle().pipe(
      finalize(() => {
        if (!service || !request.apiKey) {
          return;
        }

        // Same lazy-PrismaPromise gotcha as ApiKeyGuard's lastUsedAt update:
        // `.catch()` subscribes (triggering execution) without blocking the
        // response; a bare `void` would silently drop the query.
        this.prisma.usageLog
          .create({
            data: {
              apiKeyId: request.apiKey.id,
              service,
              endpoint: request.route.path,
            },
          })
          .catch(() => {});
      }),
    );
  }
}
