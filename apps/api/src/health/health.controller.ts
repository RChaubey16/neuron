import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { withTimeout } from '../common/with-timeout.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisHealthService } from '../queues/redis-health.service.js';

type CheckStatus = 'up' | 'down';

export interface HealthResponse {
  status: 'ok' | 'error';
  checks: { database: CheckStatus; redis: CheckStatus };
}

/** Each check gives up after this long, so a hung dependency can't hang the health check. */
const CHECK_TIMEOUT_MS = 2_000;

/**
 * Health check used by Docker and Coolify: 200 when every dependency answers,
 * 503 otherwise, with the state of each one.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisHealthService,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.run('Database', () => this.prisma.ping()),
      this.run('Redis', () => this.redis.ping()),
    ]);

    const response: HealthResponse = {
      status: database === 'up' && redis === 'up' ? 'ok' : 'error',
      checks: { database, redis },
    };
    if (response.status !== 'ok') {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }

  private async run(name: string, check: () => Promise<void>): Promise<CheckStatus> {
    try {
      await withTimeout(check(), CHECK_TIMEOUT_MS, `${name} health check`);
      return 'up';
    } catch (error) {
      this.logger.error(`${name} health check failed: ${String(error)}`);
      return 'down';
    }
  }
}
