import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type CheckStatus = 'up' | 'down';
export type OverallStatus = 'ok' | 'error';

export class HealthCheckDto {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  status: CheckStatus;

  @ApiPropertyOptional({
    description: 'Round-trip time of the check, in milliseconds',
    example: 4,
  })
  latencyMs?: number;
}

export class HealthChecksDto {
  @ApiProperty({ type: HealthCheckDto })
  app: HealthCheckDto;

  @ApiProperty({ type: HealthCheckDto })
  database: HealthCheckDto;
}

export class HealthResponseDto {
  @ApiProperty({
    enum: ['ok', 'error'],
    description: '`ok` only when every check is `up`',
    example: 'ok',
  })
  status: OverallStatus;

  @ApiProperty({ example: '2026-11-10T12:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ description: 'Process uptime in seconds', example: 3600 })
  uptimeSeconds: number;

  @ApiProperty({ type: HealthChecksDto })
  checks: HealthChecksDto;
}

export class LivenessResponseDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status: 'ok';
}
