import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import type { Response } from 'express';
import { getRequestId } from '../request-context';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  requestId?: string;
}

/**
 * Catches every exception that reaches it — `HttpException`s and anything
 * else (a raw thrown `Error`, a Prisma error, ...) — and turns it into one
 * consistent JSON error shape, instead of Nest's default behaviour of
 * returning a well-formed body for `HttpException`s but leaking a bare
 * `{statusCode, message}` (or worse) for anything else. Registered
 * globally via `APP_FILTER` in `AppModule` so it also applies inside e2e
 * tests, which build the app via `Test.createTestingModule` and don't
 * replicate `main.ts`'s bootstrap-only setup.
 *
 * A non-`HttpException` never has its internal message/stack exposed to
 * the caller — only logged server-side — since it wasn't authored as an
 * intentional HTTP response and may contain implementation details (e.g.
 * a raw Prisma error message referencing table/column names).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = this.resolveStatus(exception);
    const { message, error } = this.resolveMessageAndError(exception);
    const requestId = getRequestId();

    const body: ErrorResponseBody = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(requestId ? { requestId } : {}),
    };

    this.log(exception, request, status, message);

    response.status(status).json(body);
  }

  /**
   * A caught `HttpException` reports its own status; anything else is
   * treated as an unexpected application fault (500).
   */
  private resolveStatus(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * Extracts a caller-safe message/error label from an `HttpException`'s
   * own response body (already well-formed for Nest's built-in exceptions
   * like `NotFoundException`), and falls back to a generic message for
   * anything else so internal details never leak to the caller.
   */
  private resolveMessageAndError(exception: unknown): {
    message: string | string[];
    error: string;
  } {
    if (!(exception instanceof HttpException)) {
      return {
        message: 'Internal server error',
        error: 'Internal Server Error',
      };
    }

    const response = exception.getResponse();
    if (typeof response === 'string') {
      return { message: response, error: exception.name };
    }

    const body = response as { message?: string | string[]; error?: string };
    return {
      message: body.message ?? exception.message,
      error: body.error ?? exception.name,
    };
  }

  /**
   * Logs 5xx exceptions at 'error' with the stack trace, since those are
   * application faults worth investigating; 4xx at 'warn', since that's
   * normal caller-error traffic (bad input, missing auth) rather than a
   * bug in this app.
   */
  private log(
    exception: unknown,
    request: Request,
    status: number,
    message: string | string[],
  ): void {
    const summary = `${request.method} ${request.url} -> ${status}: ${
      Array.isArray(message) ? message.join('; ') : message
    }`;

    if (status >= 500) {
      this.logger.error(
        summary,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(summary);
    }
  }
}
