import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { lastValueFrom, of, throwError } from 'rxjs';
import { UsageLoggingInterceptor } from './usage-logging.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import { SERVICE_KEY } from '../decorators/service.decorator';

describe('UsageLoggingInterceptor', () => {
  let interceptor: UsageLoggingInterceptor;
  let prisma: { usageLog: { create: jest.Mock } };
  let reflector: { get: jest.Mock };

  const contextFor = (apiKey: { id: string } | undefined, path: string) => {
    const request: { apiKey?: { id: string }; route: { path: string } } = {
      apiKey,
      route: { path },
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => contextFor,
    } as unknown as ExecutionContext;
  };

  const handlerReturning = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });

  const handlerThrowing = (error: unknown): CallHandler => ({
    handle: () => throwError(() => error),
  });

  beforeEach(async () => {
    prisma = { usageLog: { create: jest.fn() } };
    reflector = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageLoggingInterceptor,
        { provide: PrismaService, useValue: prisma },
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();

    interceptor = module.get(UsageLoggingInterceptor);
  });

  it('writes a UsageLog row after the handler completes, for a route tagged with @Service()', async () => {
    reflector.get.mockReturnValue('notifications');
    prisma.usageLog.create.mockResolvedValue({});
    const context = contextFor({ id: 'key-1' }, '/notifications/email');

    const result = await lastValueFrom(
      interceptor.intercept(context, handlerReturning({ ok: true })),
    );

    expect(result).toEqual({ ok: true });
    expect(reflector.get).toHaveBeenCalledWith(
      SERVICE_KEY,
      context.getHandler(),
    );
    expect(prisma.usageLog.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'key-1',
        service: 'notifications',
        endpoint: '/notifications/email',
      },
    });
  });

  it('does not write a log for a route with no @Service() metadata', async () => {
    reflector.get.mockReturnValue(undefined);
    const context = contextFor({ id: 'key-1' }, '/me');

    await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

    expect(prisma.usageLog.create).not.toHaveBeenCalled();
  });

  it('does not write a log when no ApiKey was resolved on the request', async () => {
    reflector.get.mockReturnValue('notifications');
    const context = contextFor(undefined, '/notifications/email');

    await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

    expect(prisma.usageLog.create).not.toHaveBeenCalled();
  });

  it('still writes a log when the handler throws', async () => {
    reflector.get.mockReturnValue('notifications');
    prisma.usageLog.create.mockResolvedValue({});
    const context = contextFor({ id: 'key-1' }, '/notifications/email');
    const error = new Error('downstream failure');

    await expect(
      lastValueFrom(interceptor.intercept(context, handlerThrowing(error))),
    ).rejects.toThrow(error);

    expect(prisma.usageLog.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'key-1',
        service: 'notifications',
        endpoint: '/notifications/email',
      },
    });
  });

  it('subscribes to the lazy PrismaPromise instead of dropping it (void-operator regression)', async () => {
    reflector.get.mockReturnValue('notifications');
    const context = contextFor({ id: 'key-1' }, '/notifications/email');

    let subscribed = false;
    const then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => {
      subscribed = true;
      return Promise.resolve({}).then(onFulfilled, onRejected);
    };
    const lazyPrismaPromise = {
      then,
      catch: (onRejected?: (reason: unknown) => unknown) =>
        then(undefined, onRejected),
    };
    prisma.usageLog.create.mockReturnValue(lazyPrismaPromise);

    await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

    expect(subscribed).toBe(true);
  });

  it('logs an error when the UsageLog write fails, without failing the response', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    reflector.get.mockReturnValue('notifications');
    prisma.usageLog.create.mockRejectedValue(new Error('connection reset'));
    const context = contextFor({ id: 'key-1' }, '/notifications/email');

    const result = await lastValueFrom(
      interceptor.intercept(context, handlerReturning({ ok: true })),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(result).toEqual({ ok: true });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('notifications'),
      expect.anything(),
    );

    errorSpy.mockRestore();
  });
});
