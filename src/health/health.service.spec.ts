import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCER_REDIS } from '../redis/redis.module';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: { $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    redis = { ping: jest.fn().mockResolvedValue('PONG') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PRODUCER_REDIS, useValue: redis },
      ],
    }).compile();

    service = module.get(HealthService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports ok when every dependency responds', async () => {
    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('reports redis down when ping rejects', async () => {
    redis.ping.mockRejectedValue(
      new Error(
        "Stream isn't writeable and enableOfflineQueue options is false",
      ),
    );

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'down' },
    });
  });

  it('reports the database down when its query rejects', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'up' },
    });
  });

  it('reports a dependency down when its check hangs past the timeout', async () => {
    jest.useFakeTimers();
    prisma.$queryRaw.mockReturnValue(new Promise(() => {}));

    const result = service.checkReadiness();
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'up' },
    });
  });
});
