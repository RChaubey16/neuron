import { NodeEnv } from './validation.js';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  database: {
    url: string;
  };
  cors: {
    origins: string[];
  };
}

export function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Typed configuration built from validated environment variables.
 * Read it with `ConfigService<AppConfig, true>`.
 */
export default (): AppConfig => ({
  nodeEnv: (process.env.NODE_ENV as NodeEnv | undefined) ?? NodeEnv.Development,
  port: Number(process.env.PORT ?? 3000),
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  cors: {
    origins: parseList(process.env.CORS_ORIGINS),
  },
});
