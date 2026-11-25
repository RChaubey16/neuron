import { MESSAGE_STATUSES, SEND_EMAIL_JOB } from '@neuron/core';
import { MessageStatus, type User } from '@neuron/db';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateApiKey } from '../src/api-keys/api-key.js';
import { EmailsService } from '../src/emails/emails.service.js';
import {
  MAX_HTML_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
} from '../src/emails/send-email.dto.js';
import {
  createTestApp,
  createUser,
  resetDatabase,
  resetQueue,
  sessionCookie,
  type TestApp,
} from './support/test-app.js';
import { TEST_EMAIL_FROM } from './support/test-env.mjs';

const validEmail = {
  to: 'recipient@example.com',
  subject: 'Welcome to Neuron',
  html: '<p>Hello!</p>',
};

describe('POST /v1/emails (e2e)', () => {
  let t: TestApp;
  let user: User;
  let apiKey: { id: string; key: string };

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetQueue(t.emailQueue);
    user = await createUser(t.prisma);
    const { key, prefix, hash } = generateApiKey();
    const created = await t.prisma.apiKey.create({
      data: { userId: user.id, name: 'test', prefix, keyHash: hash },
    });
    apiKey = { id: created.id, key };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await t.app.close();
  });

  function send(body: unknown, key = apiKey.key) {
    return request(t.app.getHttpServer())
      .post('/v1/emails')
      .set('Authorization', `Bearer ${key}`)
      .send(body as object);
  }

  async function expectNothingStored(): Promise<void> {
    expect(await t.prisma.message.count()).toBe(0);
    expect(await t.emailQueue.count()).toBe(0);
  }

  describe('accepting an email', () => {
    it('returns 202 with the message ID and status queued', async () => {
      const response = await send(validEmail).expect(202);

      expect(response.body).toEqual({ id: expect.any(String) as string, status: 'queued' });
    });

    it('stores the message with the configured sender, the user and the key', async () => {
      const response = await send({ ...validEmail, text: 'Hello!' }).expect(202);
      const { id } = response.body as { id: string };

      const message = await t.prisma.message.findUniqueOrThrow({ where: { id } });
      expect(message).toMatchObject({
        userId: user.id,
        apiKeyId: apiKey.id,
        from: TEST_EMAIL_FROM,
        to: 'recipient@example.com',
        subject: 'Welcome to Neuron',
        html: '<p>Hello!</p>',
        text: 'Hello!',
        status: MessageStatus.queued,
        attempts: 0,
        providerMessageId: null,
        lastError: null,
        sentAt: null,
      });
    });

    it('queues one send job whose ID is the message ID', async () => {
      const response = await send(validEmail).expect(202);
      const { id } = response.body as { id: string };

      const job = await t.emailQueue.getJob(id);
      expect(job?.name).toBe(SEND_EMAIL_JOB);
      expect(job?.data).toEqual({ messageId: id });
      expect(await t.emailQueue.count()).toBe(1);
    });

    it('stores text as null when it is not sent', async () => {
      const { id } = (await send(validEmail).expect(202)).body as { id: string };

      expect((await t.prisma.message.findUniqueOrThrow({ where: { id } })).text).toBeNull();
    });

    it('trims the recipient and subject', async () => {
      const { id } = (
        await send({ ...validEmail, to: '  recipient@example.com ', subject: '  Hi  ' }).expect(202)
      ).body as { id: string };

      const message = await t.prisma.message.findUniqueOrThrow({ where: { id } });
      expect(message.to).toBe('recipient@example.com');
      expect(message.subject).toBe('Hi');
    });

    it('accepts bodies at the size limits', async () => {
      await send({
        ...validEmail,
        subject: 's'.repeat(MAX_SUBJECT_LENGTH),
        html: 'h'.repeat(MAX_HTML_LENGTH),
        text: 't'.repeat(MAX_TEXT_LENGTH),
      }).expect(202);
    });

    it('gives each email its own message and job', async () => {
      const first = (await send(validEmail).expect(202)).body as { id: string };
      const second = (await send(validEmail).expect(202)).body as { id: string };

      expect(first.id).not.toBe(second.id);
      expect(await t.prisma.message.count()).toBe(2);
      expect(await t.emailQueue.count()).toBe(2);
    });
  });

  describe('authentication', () => {
    it('returns 401 without an API key', async () => {
      await request(t.app.getHttpServer()).post('/v1/emails').send(validEmail).expect(401);
      await expectNothingStored();
    });

    it('returns 401 for a revoked key', async () => {
      await t.prisma.apiKey.update({ where: { id: apiKey.id }, data: { revokedAt: new Date() } });

      await send(validEmail).expect(401);
      await expectNothingStored();
    });

    it('does not accept a dashboard session instead of an API key', async () => {
      await request(t.app.getHttpServer())
        .post('/v1/emails')
        .set('Cookie', await sessionCookie(t.auth, user))
        .send(validEmail)
        .expect(401);
      await expectNothingStored();
    });
  });

  describe('validation', () => {
    /** validEmail with one field left out. */
    const without = (field: keyof typeof validEmail): Record<string, string> =>
      Object.fromEntries(Object.entries(validEmail).filter(([key]) => key !== field));

    it.each([
      ['a missing recipient', without('to')],
      ['an invalid recipient', { ...validEmail, to: 'not-an-email' }],
      ['a list of recipients', { ...validEmail, to: ['a@example.com', 'b@example.com'] }],
      ['a missing subject', without('subject')],
      ['a blank subject', { ...validEmail, subject: '   ' }],
      ['a subject with a line break', { ...validEmail, subject: 'Hi\r\nBcc: x@example.com' }],
      ['a subject over the limit', { ...validEmail, subject: 's'.repeat(MAX_SUBJECT_LENGTH + 1) }],
      ['missing html', without('html')],
      ['empty html', { ...validEmail, html: '' }],
      ['non-string html', { ...validEmail, html: { body: 'x' } }],
      ['html over the limit', { ...validEmail, html: 'h'.repeat(MAX_HTML_LENGTH + 1) }],
      ['empty text', { ...validEmail, text: '' }],
      ['text over the limit', { ...validEmail, text: 't'.repeat(MAX_TEXT_LENGTH + 1) }],
      ['a custom sender', { ...validEmail, from: 'someone@else.com' }],
      ['an unknown field', { ...validEmail, templateId: 'welcome' }],
    ])('returns 400 for %s, and stores nothing', async (_label, body) => {
      const response = await send(body).expect(400);

      expect((response.body as { message: unknown }).message).toBeDefined();
      await expectNothingStored();
    });

    it('returns 413 for a body over 1 MB', async () => {
      await send({ ...validEmail, html: 'h'.repeat(1024 * 1024 + 1) }).expect(413);
      await expectNothingStored();
    });
  });

  describe('when the queue is unavailable', () => {
    it('returns 503 and marks the message failed if Redis rejects the job', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(t.emailQueue, 'add').mockRejectedValueOnce(new Error('Connection is closed.'));

      const response = await send(validEmail).expect(503);

      expect((response.body as { message: string }).message).toMatch(/was not sent/);
      const message = await t.prisma.message.findFirstOrThrow();
      expect(message.status).toBe(MessageStatus.failed);
      expect(message.lastError).toMatch(/Could not be queued: Error: Connection is closed\./);
    });

    it('returns 503 instead of hanging if Redis does not answer', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const service = t.app.get(EmailsService);
      const original = service.enqueueTimeoutMs;
      service.enqueueTimeoutMs = 50;
      vi.spyOn(t.emailQueue, 'add').mockReturnValueOnce(new Promise(() => undefined));

      try {
        await send(validEmail).expect(503);
      } finally {
        service.enqueueTimeoutMs = original;
      }

      const message = await t.prisma.message.findFirstOrThrow();
      expect(message.status).toBe(MessageStatus.failed);
      expect(message.lastError).toMatch(/timed out after 50ms/);
    });
  });
});

describe('message statuses', () => {
  it('match between packages/core and the database enum', () => {
    expect(Object.values(MessageStatus).sort()).toEqual([...MESSAGE_STATUSES].sort());
  });
});
