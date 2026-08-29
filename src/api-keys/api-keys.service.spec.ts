import { createHash } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyService } from './api-keys.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let prisma: {
    apiKey: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      apiKey: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiKeyService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ApiKeyService);
  });

  describe('create', () => {
    it('generates a prefixed raw key, persists only its SHA-256 hash, and returns the raw key once', async () => {
      prisma.apiKey.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'key-1',
            createdAt: new Date('2026-08-29T00:00:00Z'),
            lastUsedAt: null,
            revokedAt: null,
            ...data,
          }),
      );

      const result = await service.create('user-1', { name: 'CI key' });

      expect(result.key).toMatch(/^nrn_/);
      expect(result.keyPrefix).toBe(result.key.slice(0, 12));

      const expectedHash = createHash('sha256')
        .update(result.key)
        .digest('hex');
      expect(prisma.apiKey.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          hashedKey: expectedHash,
          keyPrefix: result.key.slice(0, 12),
          name: 'CI key',
        },
      });
    });
  });

  describe('findAllForUser', () => {
    it("returns the user's keys as response DTOs, without the hash", async () => {
      const createdAt = new Date('2026-08-29T00:00:00Z');
      prisma.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-1',
          userId: 'user-1',
          hashedKey: 'deadbeef',
          keyPrefix: 'nrn_abcd1234',
          name: 'CI key',
          createdAt,
          lastUsedAt: null,
          revokedAt: null,
        },
      ]);

      const result = await service.findAllForUser('user-1');

      expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([
        {
          id: 'key-1',
          keyPrefix: 'nrn_abcd1234',
          name: 'CI key',
          createdAt,
          lastUsedAt: null,
          revokedAt: null,
        },
      ]);
      expect(result[0]).not.toHaveProperty('hashedKey');
    });
  });

  describe('revoke', () => {
    it("sets revokedAt on the caller's own active key", async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        revokedAt: null,
      });
      prisma.apiKey.update.mockResolvedValue({});

      await service.revoke('user-1', 'key-1');

      expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
        where: { id: 'key-1', userId: 'user-1', revokedAt: null },
      });
      expect(prisma.apiKey.update).toHaveBeenCalledTimes(1);
      const [updateArgs] = prisma.apiKey.update.mock.calls[0] as [
        { where: { id: string }; data: { revokedAt: Date } },
      ];
      expect(updateArgs.where).toEqual({ id: 'key-1' });
      expect(updateArgs.data.revokedAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when the key does not exist, is already revoked, or is not owned by the caller', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(service.revoke('user-1', 'key-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });
  });
});
