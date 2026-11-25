import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaAdapter, PrismaClient } from '@neuron/db';
import type { EnvironmentVariables } from '../config/env.validation.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({ adapter: createPrismaAdapter(config.get('DATABASE_URL', { infer: true })) });
  }

  /** Connect at startup so a wrong DATABASE_URL stops the app instead of failing the first request. */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Throws if the database cannot answer a trivial query. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
