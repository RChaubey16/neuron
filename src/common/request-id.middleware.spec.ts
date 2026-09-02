import { Request, Response } from 'express';
import { getRequestId } from './request-context';
import {
  REQUEST_ID_HEADER,
  RequestIdMiddleware,
} from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let res: { setHeader: jest.Mock };
  let next: jest.Mock;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    res = { setHeader: jest.fn() };
    next = jest.fn();
  });

  it('generates a UUID and echoes it on the response when no header is present', () => {
    const req = { headers: {} } as unknown as Request;

    middleware.use(req, res as unknown as Response, next);

    const [header, requestId] = res.setHeader.mock.calls[0] as [string, string];
    expect(header).toBe(REQUEST_ID_HEADER);
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(next).toHaveBeenCalled();
  });

  it('reuses the inbound x-request-id header instead of generating a new one', () => {
    const req = {
      headers: { [REQUEST_ID_HEADER]: 'caller-supplied-id' },
    } as unknown as Request;

    middleware.use(req, res as unknown as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'caller-supplied-id',
    );
  });

  it('makes the requestId available to getRequestId() while next() runs', () => {
    const req = {
      headers: { [REQUEST_ID_HEADER]: 'caller-supplied-id' },
    } as unknown as Request;
    let observed: string | undefined;
    next.mockImplementation(() => {
      observed = getRequestId();
    });

    middleware.use(req, res as unknown as Response, next);

    expect(observed).toBe('caller-supplied-id');
    expect(getRequestId()).toBeUndefined();
  });
});
