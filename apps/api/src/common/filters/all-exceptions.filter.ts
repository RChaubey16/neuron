import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Turns every thrown error into one JSON error shape. Unexpected errors
 * become a generic 500 so internal details never reach the client; they
 * are logged on the server instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  /**
   * Sends the error response, logging 5xx errors on the server.
   *
   * @param exception - The thrown error.
   * @param host - Current request context.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request: unknown = ctx.getRequest();

    const body = this.buildBody(
      exception,
      String(httpAdapter.getRequestUrl(request)),
    );

    if (body.statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : 'Unknown error',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    httpAdapter.reply(ctx.getResponse(), body, body.statusCode);
  }

  /**
   * Builds the JSON error body for an exception.
   *
   * @param exception - The thrown error.
   * @param path - Request URL.
   * @returns The error body; a generic 500 for non-HTTP errors.
   */
  buildBody(exception: unknown, path: string): ErrorResponseBody {
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const fallbackError = HttpStatus[statusCode] ?? 'Error';

      if (typeof response === 'string') {
        return {
          statusCode,
          error: toTitle(fallbackError),
          message: response,
          path,
          timestamp,
        };
      }

      const { message, error } = response as {
        message?: string | string[];
        error?: string;
      };
      return {
        statusCode,
        error: error ?? toTitle(fallbackError),
        message: message ?? exception.message,
        path,
        timestamp,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Internal server error',
      path,
      timestamp,
    };
  }
}

/**
 * Converts an `HttpStatus` key to title case (`NOT_FOUND` → `Not Found`).
 *
 * @param name - `HttpStatus` enum key.
 * @returns The title-cased name.
 */
function toTitle(name: string): string {
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
