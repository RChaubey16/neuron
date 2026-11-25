import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaAdapter, PrismaClient } from '@neuron/db';
import type { EnvironmentVariables } from '../config/env.validation.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({ adapter: createPrismaAdapter(config.get('DATABASE_URL', { infer: true })) });
  }

  /** Connect at startup so a wrong DATABASE_URL stops the worker before it takes jobs. */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
