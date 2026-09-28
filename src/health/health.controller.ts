import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { ReadinessResponseDto } from './dto/readiness-response.dto';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness: the process is up and serving HTTP, regardless of dependencies. */
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: 200 if Postgres and Redis both respond, 503 otherwise. */
  @Get('ready')
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessResponseDto> {
    const readiness = await this.healthService.checkReadiness();
    // Set directly rather than throwing, so the body keeps the per-check
    // breakdown instead of GlobalExceptionFilter's generic error shape.
    if (readiness.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }
}
