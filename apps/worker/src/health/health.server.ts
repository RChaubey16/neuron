import { createServer, type Server } from 'node:http';
import { InjectQueue } from '@nestjs/bullmq';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_QUEUE } from '@neuron/core';
import { Queue } from 'bullmq';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { SendEmailProcessor } from '../messages/send-email.processor.js';
import { PrismaService } from '../prisma/prisma.service.js';

type CheckStatus = 'up' | 'down';

export interface WorkerHealth {
  status: 'ok' | 'error';
  checks: { database: CheckStatus; redis: CheckStatus; worker: CheckStatus };
}

/** Each check gives up after this long, so a hung dependency can't hang the health check. */
const CHECK_TIMEOUT_MS = 2_000;

async function withTimeout(promise: Promise<unknown>, what: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${CHECK_TIMEOUT_MS}ms`)),
      CHECK_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The worker has no API, so it runs this small HTTP server for Docker's and
 * Coolify's health check: `GET /health` answers 200 when Postgres and Redis
 * answer and the BullMQ worker is running, and 503 otherwise. The port is
 * internal to the container and isn't published.
 */
@Injectable()
export class HealthServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HealthServer.name);
  private server?: Server;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly prisma: PrismaService,
    private readonly processor: SendEmailProcessor,
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const port = this.config.get('WORKER_HEALTH_PORT', { infer: true });
    const server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/health') {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"Not found"}');
        return;
      }
      this.check().then(
        (health) => {
          res
            .writeHead(health.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' })
            .end(JSON.stringify(health));
        },
        (error: unknown) => {
          this.logger.error(`Health check failed: ${String(error)}`);
          res.writeHead(503, { 'content-type': 'application/json' }).end('{"status":"error"}');
        },
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.logger.log(`Health check listening on port ${port}`);
  }

  async check(): Promise<WorkerHealth> {
    const [database, redis] = await Promise.all([
      this.run('Database', () => this.prisma.$queryRaw`SELECT 1`),
      this.run('Redis', () => this.pingRedis()),
    ]);
    const worker: CheckStatus = this.processor.worker.isRunning() ? 'up' : 'down';
    if (worker === 'down') {
      this.logger.error('Health check failed: the BullMQ worker is not running');
    }

    const ok = database === 'up' && redis === 'up' && worker === 'up';
    return { status: ok ? 'ok' : 'error', checks: { database, redis, worker } };
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async pingRedis(): Promise<void> {
    const client = await this.queue.backend.client;
    // BullMQ's ioredis adapter calls the ioredis method of this name, so lowercase.
    const reply: unknown = await client.runCommand('ping', []);
    if (reply !== 'PONG') {
      throw new Error(`Unexpected PING reply: ${String(reply)}`);
    }
  }

  private async run(name: string, check: () => Promise<unknown>): Promise<CheckStatus> {
    try {
      await withTimeout(check(), `${name} health check`);
      return 'up';
    } catch (error) {
      this.logger.error(`${name} health check failed: ${String(error)}`);
      return 'down';
    }
  }
}
