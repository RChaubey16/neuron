import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type CheckStatus = 'up' | 'down';

export interface HealthResponse {
  status: 'ok' | 'error';
  checks: { database: CheckStatus };
}

/**
 * Health check used by Docker and Coolify: 200 when every dependency answers,
 * 503 otherwise. A Redis check is added once the API connects to Redis.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const database = await this.checkDatabase();
    const response: HealthResponse = {
      status: database === 'up' ? 'ok' : 'error',
      checks: { database },
    };

    if (response.status !== 'ok') {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }

  private async checkDatabase(): Promise<CheckStatus> {
    try {
      await this.prisma.ping();
      return 'up';
    } catch (error) {
      this.logger.error(`Database health check failed: ${String(error)}`);
      return 'down';
    }
  }
}
