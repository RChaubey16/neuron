import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfig } from '@/config/configuration.js';
import { PrismaClient } from '@/generated/prisma/client.js';

/**
 * The single database client for the app. Connects through DATABASE_URL
 * (Supabase transaction pooler) with the node-postgres driver adapter.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<AppConfig, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('database.url', { infer: true }),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    // Fail loudly in the logs, but keep the app running so the health
    // check can report the database as down instead of crash-looping.
    if (await this.ping()) {
      this.logger.log('Database connection established');
    } else {
      this.logger.error('Database is unreachable at startup');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Returns true when the database answers a trivial query. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      // Driver messages do not contain the connection string.
      this.logger.warn(
        `Database ping failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }
}
