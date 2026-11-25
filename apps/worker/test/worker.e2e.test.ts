import { SEND_EMAIL_JOB } from '@neuron/core';
import { MessageStatus } from '@neuron/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMessage,
  createTestWorker,
  findInMailpit,
  resetState,
  type TestWorker,
  waitForJob,
} from './support/test-worker.js';

/**
 * The whole path with nothing faked: a job in Redis, the BullMQ worker, the
 * message in Postgres, and SMTP delivery to Mailpit.
 * Needs `pnpm infra:up`.
 */
describe('Worker (e2e: Redis, Postgres, SMTP to Mailpit)', () => {
  let t: TestWorker;

  beforeAll(async () => {
    t = await createTestWorker();
  });

  beforeEach(async () => {
    await resetState(t);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await t.module.close();
  });

  it('sends a queued message to Mailpit and marks it sent', async () => {
    const message = await createMessage(t.prisma, {
      subject: 'Worker e2e',
      html: '<h1>Hello from the worker</h1>',
      text: 'Hello from the worker',
    });

    await t.queue.add(SEND_EMAIL_JOB, { messageId: message.id }, { jobId: message.id });

    expect(await waitForJob(t.queue, message.id)).toBe('completed');

    const stored = await t.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.status).toBe(MessageStatus.sent);
    expect(stored.attempts).toBe(1);
    expect(stored.sentAt).toBeInstanceOf(Date);
    expect(stored.providerMessageId).toMatch(/^<.+@.+>$/);

    const { message: email, headers } = await findInMailpit(message.to);
    expect(email.From).toEqual({ Name: 'Neuron Test', Address: 'noreply@neuron.test' });
    expect(email.To).toEqual([{ Name: '', Address: message.to }]);
    expect(email.Subject).toBe('Worker e2e');
    expect(email.HTML).toContain('<h1>Hello from the worker</h1>');
    expect(email.Text.trim()).toBe('Hello from the worker');
    expect(headers['X-Neuron-Message-Id']).toEqual([message.id]);
    expect(headers['Message-Id']).toEqual([stored.providerMessageId]);

    const job = await t.queue.getJob(message.id);
    expect(job?.returnvalue).toEqual({
      result: 'sent',
      providerMessageId: stored.providerMessageId,
    });
  });

  it('completes the job without sending when the message was already marked failed', async () => {
    const message = await createMessage(t.prisma, {
      status: MessageStatus.failed,
      lastError: 'Could not be queued: TimeoutError',
    });

    await t.queue.add(SEND_EMAIL_JOB, { messageId: message.id }, { jobId: message.id });

    expect(await waitForJob(t.queue, message.id)).toBe('completed');
    const job = await t.queue.getJob(message.id);
    expect(job?.returnvalue).toEqual({
      result: 'skipped',
      reason: 'not_sendable',
      status: MessageStatus.failed,
    });
    const stored = await t.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored).toEqual(message);
  });

  it('fails a job with malformed data without retrying it', async () => {
    await t.queue.add(SEND_EMAIL_JOB, { messageId: 'not-a-uuid' }, { jobId: 'bad-data' });

    expect(await waitForJob(t.queue, 'bad-data')).toBe('failed');
    const job = await t.queue.getJob('bad-data');
    expect(job?.failedReason).toMatch(/Invalid job data/);
  });

  it('fails a job with an unknown name', async () => {
    await t.queue.add(
      'unknown',
      { messageId: '0190f6a0-0000-7000-8000-000000000000' },
      {
        jobId: 'unknown-name',
      },
    );

    expect(await waitForJob(t.queue, 'unknown-name')).toBe('failed');
    expect((await t.queue.getJob('unknown-name'))?.failedReason).toMatch(/Unknown job name/);
  });

  it('works through several messages', async () => {
    const messages = await Promise.all(Array.from({ length: 5 }, () => createMessage(t.prisma)));

    await t.queue.addBulk(
      messages.map((m) => ({
        name: SEND_EMAIL_JOB,
        data: { messageId: m.id },
        opts: { jobId: m.id },
      })),
    );

    for (const m of messages) {
      expect(await waitForJob(t.queue, m.id)).toBe('completed');
    }
    const statuses = await t.prisma.message.findMany({ select: { status: true } });
    expect(statuses.every((s) => s.status === MessageStatus.sent)).toBe(true);
  });
});
