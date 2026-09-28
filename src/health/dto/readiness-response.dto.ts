import { Expose } from 'class-transformer';

export type DependencyStatus = 'up' | 'down';

/** Result of `GET /health/ready`: overall status plus each dependency's. */
export class ReadinessResponseDto {
  @Expose()
  status: 'ok' | 'error';

  @Expose()
  checks: { database: DependencyStatus; redis: DependencyStatus };

  constructor(checks: ReadinessResponseDto['checks']) {
    this.checks = checks;
    this.status = Object.values(checks).every((check) => check === 'up')
      ? 'ok'
      : 'error';
  }
}
