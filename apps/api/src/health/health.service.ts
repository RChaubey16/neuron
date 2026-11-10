import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service.js';
import {
  HealthCheckDto,
  HealthResponseDto,
} from './dto/health-response.dto.js';

/** A database check slower than this counts as down. */
export const DATABASE_CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponseDto> {
    const database = await this.checkDatabase();
    const app: HealthCheckDto = { status: 'up' };

    return {
      status: database.status === 'up' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks: { app, database },
    };
  }

  private async checkDatabase(): Promise<HealthCheckDto> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), DATABASE_CHECK_TIMEOUT_MS);
    });

    try {
      const up = await Promise.race([this.prisma.ping(), timeout]);
      if (!up) {
        return { status: 'down' };
      }
      return {
        status: 'up',
        latencyMs: Math.round(performance.now() - started),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
