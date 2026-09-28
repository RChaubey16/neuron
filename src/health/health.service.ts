import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCER_REDIS } from '../redis/redis.module';
import {
  DependencyStatus,
  ReadinessResponseDto,
} from './dto/readiness-response.dto';

// Uptime monitors typically time out at 5–30s; answering well inside that
// means a hung dependency reports as "down" instead of as a timed-out check.
const CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PRODUCER_REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Checks every dependency the API needs to serve requests, in parallel.
   * Never throws — a failed or slow check is reported as "down".
   *
   * @returns Each dependency's status, and "ok" only if all are up
   */
  async checkReadiness(): Promise<ReadinessResponseDto> {
    const [database, redis] = await Promise.all([
      this.probe(() => this.prisma.$queryRaw`SELECT 1`),
      this.probe(() => this.redis.ping()),
    ]);
    return new ReadinessResponseDto({ database, redis });
  }

  /**
   * Runs one dependency check, treating a rejection or a timeout as "down".
   * A timeout is only needed for Postgres in practice: the Redis
   * connection has its offline queue disabled, so `ping()` rejects
   * immediately while disconnected.
   */
  private async probe(
    check: () => Promise<unknown>,
  ): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Health check timed out')),
        CHECK_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([check(), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
