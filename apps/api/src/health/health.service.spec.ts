import { PrismaService } from '@/prisma/prisma.service.js';
import { DATABASE_CHECK_TIMEOUT_MS, HealthService } from './health.service.js';

function serviceWithPing(ping: () => Promise<boolean>): HealthService {
  return new HealthService({ ping } as unknown as PrismaService);
}

describe('HealthService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports ok when the database is up', async () => {
    const result = await serviceWithPing(async () => true).check();

    expect(result.status).toBe('ok');
    expect(result.checks.app).toEqual({ status: 'up' });
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.uptimeSeconds)).toBe(true);
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('reports error when the database is down', async () => {
    const result = await serviceWithPing(async () => false).check();

    expect(result.status).toBe('error');
    expect(result.checks.app.status).toBe('up');
    expect(result.checks.database).toEqual({ status: 'down' });
  });

  it('treats a hanging database as down after the timeout', async () => {
    vi.useFakeTimers();
    const pending = serviceWithPing(
      () => new Promise<boolean>(() => {}),
    ).check();

    await vi.advanceTimersByTimeAsync(DATABASE_CHECK_TIMEOUT_MS);
    const result = await pending;

    expect(result.status).toBe('error');
    expect(result.checks.database).toEqual({ status: 'down' });
  });
});
