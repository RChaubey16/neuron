import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AppConfig } from '../src/config/configuration.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('PrismaService (e2e, test database)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    moduleRef.useLogger(false);
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('answers a ping', async () => {
    await expect(prisma.ping()).resolves.toBe(true);
  });

  it('runs raw queries', async () => {
    const rows = await prisma.$queryRaw<{ value: number }[]>`SELECT 1 AS value`;
    expect(rows).toEqual([{ value: 1 }]);
  });

  it('sees the stub auth.users table', async () => {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT to_regclass('auth.users') IS NOT NULL AS "exists"`;
    expect(rows[0]?.exists).toBe(true);
  });

  it('reports an unreachable database as down instead of throwing', async () => {
    const config = {
      get: () => 'postgresql://nobody:wrong@127.0.0.1:1/none',
    } as unknown as ConfigService<AppConfig, true>;
    const unreachable = new PrismaService(config);
    // Silence the expected warning.
    Object.assign(unreachable, { logger: { warn: () => undefined } });

    await expect(unreachable.ping()).resolves.toBe(false);
    await unreachable.$disconnect();
  });
});
