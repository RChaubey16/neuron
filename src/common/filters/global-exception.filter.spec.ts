import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { runWithRequestId } from '../request-context';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let res: { status: jest.Mock; json: jest.Mock };
  let host: ArgumentsHost;
  let loggerError: jest.SpyInstance;
  let loggerWarn: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const req = { method: 'GET', url: '/things/1' };
    host = {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => req,
      }),
    } as unknown as ArgumentsHost;

    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the HttpException status, message and error verbatim', () => {
    filter.catch(new NotFoundException('thing not found'), host);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'thing not found',
        error: 'Not Found',
        path: '/things/1',
      }),
    );
  });

  it('maps a non-HttpException to a generic 500 without leaking its message', () => {
    filter.catch(new Error('leaked table name in prisma error'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
      }),
    );
  });

  it('includes the requestId from the async-local request context when one is active', () => {
    runWithRequestId('req-xyz', () => {
      filter.catch(new BadRequestException('bad input'), host);
    });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-xyz' }),
    );
  });

  it('omits requestId entirely when none is active', () => {
    filter.catch(new BadRequestException('bad input'), host);

    const [body] = res.json.mock.calls[0] as [Record<string, unknown>];
    expect('requestId' in body).toBe(false);
  });

  it('logs a 5xx at error level with the stack trace', () => {
    const error = new Error('boom');
    filter.catch(error, host);

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('GET /things/1 -> 500'),
      error.stack,
    );
  });

  it('logs a 4xx at warn level, not error', () => {
    filter.catch(new NotFoundException('thing not found'), host);

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('GET /things/1 -> 404'),
    );
    expect(loggerError).not.toHaveBeenCalled();
  });
});
