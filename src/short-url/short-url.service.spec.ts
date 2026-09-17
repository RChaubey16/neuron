import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ShortUrlService } from './short-url.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
  });
}

describe('ShortUrlService', () => {
  let service: ShortUrlService;
  let prisma: {
    shortUrl: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      shortUrl: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShortUrlService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ShortUrlService);
  });

  describe('create', () => {
    it("generates a short code and persists it against the caller's apiKeyId", async () => {
      prisma.shortUrl.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'short-1',
            createdAt: new Date('2026-08-30T00:00:00Z'),
            clickCount: 0,
            ...data,
          }),
      );

      const result = await service.create(
        { userId: 'user-1', apiKeyId: 'key-1' },
        { originalUrl: 'https://example.com/very/long/path' },
      );

      expect(result.code).toMatch(/^[A-Za-z0-9_-]{7}$/);
      expect(result.originalUrl).toBe('https://example.com/very/long/path');
      expect(result.clickCount).toBe(0);
      expect(prisma.shortUrl.create).toHaveBeenCalledWith({
        data: {
          code: result.code,
          originalUrl: 'https://example.com/very/long/path',
          userId: 'user-1',
          apiKeyId: 'key-1',
        },
      });
    });

    it('retries with a fresh code on a unique-constraint collision', async () => {
      prisma.shortUrl.create
        .mockRejectedValueOnce(uniqueConstraintError())
        .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'short-1',
            createdAt: new Date('2026-08-30T00:00:00Z'),
            clickCount: 0,
            ...data,
          }),
        );

      const result = await service.create(
        { userId: 'user-1', apiKeyId: 'key-1' },
        { originalUrl: 'https://example.com' },
      );

      expect(prisma.shortUrl.create).toHaveBeenCalledTimes(2);
      expect(result.originalUrl).toBe('https://example.com');
    });

    it('throws ConflictException after exhausting collision retries', async () => {
      prisma.shortUrl.create.mockRejectedValue(uniqueConstraintError());

      await expect(
        service.create(
          { userId: 'user-1', apiKeyId: 'key-1' },
          { originalUrl: 'https://example.com' },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows unexpected errors without retrying', async () => {
      prisma.shortUrl.create.mockRejectedValue(new Error('db is down'));

      await expect(
        service.create(
          { userId: 'user-1', apiKeyId: 'key-1' },
          { originalUrl: 'https://example.com' },
        ),
      ).rejects.toThrow('db is down');
      expect(prisma.shortUrl.create).toHaveBeenCalledTimes(1);
    });

    it('persists a dashboard-originated URL with no apiKeyId', async () => {
      prisma.shortUrl.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'short-1',
            createdAt: new Date('2026-08-30T00:00:00Z'),
            clickCount: 0,
            ...data,
          }),
      );

      await service.create(
        { userId: 'user-1' },
        { originalUrl: 'https://example.com' },
      );

      expect(prisma.shortUrl.create).toHaveBeenCalledWith({
        data: {
          code: expect.any(String),
          originalUrl: 'https://example.com',
          userId: 'user-1',
          apiKeyId: undefined,
        },
      });
    });
  });

  describe('findAllForUser', () => {
    it("scopes results to the given user's own API keys, most recent first", async () => {
      prisma.shortUrl.findMany.mockResolvedValue([
        {
          code: 'aaa1111',
          originalUrl: 'https://example.com/a',
          createdAt: new Date('2026-09-16T00:00:00Z'),
          clickCount: 3,
        },
      ]);
      prisma.shortUrl.count.mockResolvedValue(1);

      const result = await service.findAllForUser('user-1', 20, 0);

      expect(prisma.shortUrl.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      });
      expect(prisma.shortUrl.count).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(result).toEqual({
        items: [
          {
            code: 'aaa1111',
            originalUrl: 'https://example.com/a',
            createdAt: new Date('2026-09-16T00:00:00Z'),
            clickCount: 3,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });
    });

    it('passes limit/offset through for pagination', async () => {
      prisma.shortUrl.findMany.mockResolvedValue([]);
      prisma.shortUrl.count.mockResolvedValue(45);

      const result = await service.findAllForUser('user-1', 10, 20);

      expect(prisma.shortUrl.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 }),
      );
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      expect(result.total).toBe(45);
    });
  });

  describe('findAllForApiKey', () => {
    it('scopes results to only the calling API key, not sibling keys under the same user', async () => {
      prisma.shortUrl.findMany.mockResolvedValue([
        {
          code: 'bbb2222',
          originalUrl: 'https://example.com/b',
          createdAt: new Date('2026-09-16T00:00:00Z'),
          clickCount: 0,
        },
      ]);
      prisma.shortUrl.count.mockResolvedValue(1);

      const result = await service.findAllForApiKey('key-1', 20, 0);

      expect(prisma.shortUrl.findMany).toHaveBeenCalledWith({
        where: { apiKeyId: 'key-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      });
      expect(prisma.shortUrl.count).toHaveBeenCalledWith({
        where: { apiKeyId: 'key-1' },
      });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('resolve', () => {
    it('returns the originalUrl for a known code and increments clickCount asynchronously', async () => {
      prisma.shortUrl.findUnique.mockResolvedValue({
        code: 'abc1234',
        originalUrl: 'https://example.com',
        clickCount: 2,
      });
      prisma.shortUrl.update.mockResolvedValue({});

      const originalUrl = await service.resolve('abc1234');

      expect(originalUrl).toBe('https://example.com');
      expect(prisma.shortUrl.findUnique).toHaveBeenCalledWith({
        where: { code: 'abc1234' },
      });
      expect(prisma.shortUrl.update).toHaveBeenCalledWith({
        where: { code: 'abc1234' },
        data: { clickCount: { increment: 1 } },
      });
    });

    it('throws NotFoundException for an unknown code', async () => {
      prisma.shortUrl.findUnique.mockResolvedValue(null);

      await expect(service.resolve('nosuchcode')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.shortUrl.update).not.toHaveBeenCalled();
    });

    it('subscribes to the lazy clickCount PrismaPromise instead of dropping it (void-operator regression)', async () => {
      prisma.shortUrl.findUnique.mockResolvedValue({
        code: 'abc1234',
        originalUrl: 'https://example.com',
        clickCount: 0,
      });

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
      prisma.shortUrl.update.mockReturnValue(lazyPrismaPromise);

      await service.resolve('abc1234');

      expect(subscribed).toBe(true);
    });

    it('logs an error when the clickCount update fails, without failing the redirect', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      prisma.shortUrl.findUnique.mockResolvedValue({
        code: 'abc1234',
        originalUrl: 'https://example.com',
        clickCount: 0,
      });
      prisma.shortUrl.update.mockRejectedValue(new Error('connection reset'));

      const originalUrl = await service.resolve('abc1234');
      await new Promise((resolve) => setImmediate(resolve));

      expect(originalUrl).toBe('https://example.com');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('abc1234'),
        expect.anything(),
      );

      errorSpy.mockRestore();
    });
  });
});
