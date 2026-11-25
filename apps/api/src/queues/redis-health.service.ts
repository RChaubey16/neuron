import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { EMAIL_QUEUE } from '@neuron/core';
import { Queue } from 'bullmq';

@Injectable()
export class RedisHealthService {
  constructor(@InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue) {}

  /** Throws unless the queue's Redis connection answers PING. */
  async ping(): Promise<void> {
    const client = await this.emailQueue.backend.client;
    // BullMQ's ioredis adapter calls the ioredis method of this name, so lowercase.
    const reply: unknown = await client.runCommand('ping', []);
    if (reply !== 'PONG') {
      throw new Error(`Unexpected PING reply: ${String(reply)}`);
    }
  }
}
