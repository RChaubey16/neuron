import { Test, TestingModule } from '@nestjs/testing';
import { UsageService } from './usage.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsageService', () => {
  let service: UsageService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsageService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsageService);
  });

  describe('getSummaryForUser', () => {
    it("returns call counts grouped by service, day, and key, scoped to the caller's own keys", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          service: 'notifications',
          date: new Date('2026-08-30T00:00:00Z'),
          apiKeyId: 'key-1',
          count: 3n,
        },
      ]);

      const result = await service.getSummaryForUser('user-1');

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        {
          service: 'notifications',
          date: '2026-08-30',
          apiKeyId: 'key-1',
          count: 3,
        },
      ]);
    });

    it('returns an empty array when the user has no usage', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getSummaryForUser('user-1');

      expect(result).toEqual([]);
    });
  });
});
