import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
}

/**
 * Liveness check used by Docker and Coolify. Checks for Postgres and Redis are
 * added here once the API connects to them.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
