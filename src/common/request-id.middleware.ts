import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request } from 'express';
import type { NextFunction, Response } from 'express';
import { runWithRequestId } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

// An inbound id is echoed on the response and stamped on every log line for
// the request, so only reuse one that looks like a correlation id (UUIDs,
// trace ids): bounded length, no whitespace or punctuation beyond - _ . :
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Assigns every request a correlation ID — reusing the inbound
 * `x-request-id` header when the caller supplied a well-formed one,
 * otherwise generating a fresh UUID — echoes it back on the response, and makes it available to
 * the structured logger and the global exception filter for the lifetime
 * of the request via AsyncLocalStorage.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inboundHeader = req.headers[REQUEST_ID_HEADER];
    const inbound = Array.isArray(inboundHeader)
      ? inboundHeader[0]
      : inboundHeader;
    const requestId =
      inbound && VALID_REQUEST_ID.test(inbound) ? inbound : randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);
    runWithRequestId(requestId, next);
  }
}
