import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: configService.get<string>('DATABASE_URL'),
      }),
    });
  }

  /**
   * Opens the Prisma database connection when the module is initialized.
   */
  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Closes the Prisma database connection when the module is destroyed,
   * e.g. during application shutdown.
   */
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
