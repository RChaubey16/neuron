import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request } from 'express';
import type { NextFunction, Response } from 'express';
import { runWithRequestId } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assigns every request a correlation ID — reusing the inbound
 * `x-request-id` header when the caller supplied one, otherwise generating
 * a fresh UUID — echoes it back on the response, and makes it available to
 * the structured logger and the global exception filter for the lifetime
 * of the request via AsyncLocalStorage.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inboundHeader = req.headers[REQUEST_ID_HEADER];
    const requestId =
      (Array.isArray(inboundHeader) ? inboundHeader[0] : inboundHeader) ||
      randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);
    runWithRequestId(requestId, next);
  }
}
