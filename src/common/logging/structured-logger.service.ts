import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { getRequestId } from '../request-context';

interface JsonLogOptions {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: 'stdout' | 'stderr';
  errorStack?: unknown;
}

interface JsonLogObject {
  level: LogLevel;
  pid: number;
  timestamp: number;
  message: unknown;
  context?: string;
  stack?: unknown;
  requestId?: string;
}

/**
 * App-wide logger, wired in `main.ts` via
 * `NestFactory.create(AppModule, { logger: new StructuredLogger() })` so
 * every `new Logger(...)` call throughout the app (Nest's internal logs
 * included) routes through it. Builds on Nest's own `ConsoleLogger` in
 * `json: true` mode rather than hand-rolling message/context/stack
 * parsing, and adds the current request's correlation ID (set by
 * `RequestIdMiddleware`) to each line so a log entry can be tied back to
 * the request that produced it.
 */
export class StructuredLogger extends ConsoleLogger {
  constructor() {
    super({ json: true });
  }

  protected getJsonLogObject(
    message: unknown,
    options: JsonLogOptions,
  ): JsonLogObject {
    const logObject = super.getJsonLogObject(message, options);
    const requestId = getRequestId();
    return requestId ? { ...logObject, requestId } : logObject;
  }
}
