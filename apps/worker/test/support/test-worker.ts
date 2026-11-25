import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { EMAIL_QUEUE, type SendEmailJobData } from '@neuron/core';
import type { Message, Prisma } from '@neuron/db';
import type { Queue } from 'bullmq';
import { vi } from 'vitest';
import type { DeliveryResult } from '../../src/channels/channel.js';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type OutgoingEmail,
} from '../../src/email/email-provider.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { WorkerModule } from '../../src/worker.module.js';
import { MAILPIT_API_URL } from './test-env.mjs';

/** Stands in for a real provider: the tests decide whether sending works. */
export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  send = vi.fn((email: OutgoingEmail): Promise<DeliveryResult> =>
    Promise.resolve({ providerMessageId: `fake-${email.messageId}` }),
  );
}

export interface TestWorker {
  module: TestingModule;
  prisma: PrismaService;
  queue: Queue<SendEmailJobData>;
}

/**
 * Starts the real worker module: it connects to the test database and Redis
 * and starts processing jobs. Pass a provider to replace SMTP.
 */
export async function createTestWorker(provider?: EmailProvider): Promise<TestWorker> {
  let builder = Test.createTestingModule({ imports: [WorkerModule] });
  if (provider) {
    builder = builder.overrideProvider(EMAIL_PROVIDER).useValue(provider);
  }
  const module = await builder.compile();
  await module.init();

  return {
    module,
    prisma: module.get(PrismaService),
    queue: module.get<Queue<SendEmailJobData>>(getQueueToken(EMAIL_QUEUE)),
  };
}

export async function resetState(t: TestWorker): Promise<void> {
  await t.queue.obliterate({ force: true });
  await t.prisma.$executeRawUnsafe('TRUNCATE TABLE "messages", "api_keys", "users" CASCADE');
}

/** Creates a user, an API key and a message, as the API would. */
export async function createMessage(
  prisma: PrismaService,
  overrides: Partial<Prisma.MessageUncheckedCreateInput> = {},
): Promise<Message> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { googleId: `google-${suffix}`, email: `owner-${suffix}@example.com` },
  });
  const apiKey = await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: 'test',
      prefix: 'nrn_test0000',
      keyHash: suffix.padEnd(64, '0'),
    },
  });
  return prisma.message.create({
    data: {
      userId: user.id,
      apiKeyId: apiKey.id,
      from: 'Neuron Test <noreply@neuron.test>',
      to: `recipient-${suffix}@example.com`,
      subject: 'Test subject',
      html: '<p>Test body</p>',
      text: 'Test body',
      ...overrides,
    },
  });
}

/** Waits until a job has finished, one way or the other. */
export async function waitForJob(
  queue: Queue,
  jobId: string,
  timeoutMs = 10_000,
): Promise<'completed' | 'failed'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await queue.getJobState(jobId);
    if (state === 'completed' || state === 'failed') return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

interface MailpitSummary {
  ID: string;
}

export interface MailpitMessage {
  From: { Name: string; Address: string };
  To: { Name: string; Address: string }[];
  Subject: string;
  HTML: string;
  Text: string;
}

/** Finds the email Mailpit received for a recipient, waiting briefly for it to arrive. */
export async function findInMailpit(
  to: string,
): Promise<{ message: MailpitMessage; headers: Record<string, string[]> }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const search = await fetch(
      `${MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages } = (await search.json()) as { messages: MailpitSummary[] };
    const id = messages[0]?.ID;
    if (id) {
      const message = (await (
        await fetch(`${MAILPIT_API_URL}/api/v1/message/${id}`)
      ).json()) as MailpitMessage;
      const headers = (await (
        await fetch(`${MAILPIT_API_URL}/api/v1/message/${id}/headers`)
      ).json()) as Record<string, string[]>;
      return { message, headers };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Mailpit received no email for ${to}`);
}
