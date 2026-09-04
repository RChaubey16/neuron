import { createHash } from 'crypto';
import {
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prisma: {
    apiKey: { findFirst: jest.Mock; update: jest.Mock };
  };

  const contextFor = (headers: Record<string, string> = {}) => {
    const request: { headers: Record<string, string>; apiKey?: unknown } = {
      headers,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(async () => {
    prisma = {
      apiKey: { findFirst: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiKeyGuard, { provide: PrismaService, useValue: prisma }],
    }).compile();

    guard = module.get(ApiKeyGuard);
  });

  it('allows the request and attaches the resolved key for a valid, active key', async () => {
    const rawKey = 'nrn_validkeymaterial';
    const hashedKey = createHash('sha256').update(rawKey).digest('hex');
    const apiKey = { id: 'key-1', userId: 'user-1', revokedAt: null };
    prisma.apiKey.findFirst.mockResolvedValue(apiKey);
    prisma.apiKey.update.mockResolvedValue(apiKey);

    const { context, request } = contextFor({ 'x-api-key': rawKey });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
      where: { hashedKey, revokedAt: null },
    });
    expect(request.apiKey).toBe(apiKey);
  });

  it('throws UnauthorizedException when the x-api-key header is missing', async () => {
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when no active key matches the hash', async () => {
    prisma.apiKey.findFirst.mockResolvedValue(null);
    const { context } = contextFor({ 'x-api-key': 'nrn_unknownorrevoked' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('updates lastUsedAt asynchronously without blocking the request', async () => {
    const rawKey = 'nrn_validkeymaterial';
    const apiKey = { id: 'key-1', userId: 'user-1', revokedAt: null };
    prisma.apiKey.findFirst.mockResolvedValue(apiKey);

    // Real Prisma query builders return lazy "PrismaPromise"s that only
    // execute once something subscribes via `.then()`/`.catch()` — a plain
    // native Promise executes its work eagerly regardless of subscription,
    // so it can't catch a caller that drops the reference without
    // subscribing (e.g. `void promise`). This double mimics that laziness.
    let subscribed = false;
    const then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => {
      subscribed = true;
      return Promise.resolve(apiKey).then(onFulfilled, onRejected);
    };
    const lazyPrismaPromise = {
      then,
      catch: (onRejected?: (reason: unknown) => unknown) =>
        then(undefined, onRejected),
    };
    prisma.apiKey.update.mockReturnValue(lazyPrismaPromise);
    const { context } = contextFor({ 'x-api-key': rawKey });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(prisma.apiKey.update).toHaveBeenCalledTimes(1);
    const [updateArgs] = prisma.apiKey.update.mock.calls[0] as [
      { where: { id: string }; data: { lastUsedAt: Date } },
    ];
    expect(updateArgs.where).toEqual({ id: 'key-1' });
    expect(updateArgs.data.lastUsedAt).toBeInstanceOf(Date);
    expect(subscribed).toBe(true);
  });

  it('logs an error when the lastUsedAt update fails, without failing the request', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const rawKey = 'nrn_validkeymaterial';
    const apiKey = { id: 'key-1', userId: 'user-1', revokedAt: null };
    prisma.apiKey.findFirst.mockResolvedValue(apiKey);
    prisma.apiKey.update.mockRejectedValue(new Error('connection reset'));
    const { context } = contextFor({ 'x-api-key': rawKey });

    const result = await guard.canActivate(context);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('key-1'),
      expect.anything(),
    );

    errorSpy.mockRestore();
  });
});
