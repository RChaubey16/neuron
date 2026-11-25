import { randomUUID } from 'node:crypto';
import { MessageStatus } from '@neuron/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MESSAGE_ID_HEADER } from '../src/email/email-provider.js';
import { MessageSender } from '../src/messages/message-sender.service.js';
import {
  createMessage,
  createTestWorker,
  FakeEmailProvider,
  resetState,
  type TestWorker,
} from './support/test-worker.js';

describe('MessageSender (e2e, real database, fake provider)', () => {
  const provider = new FakeEmailProvider();
  let t: TestWorker;
  let sender: MessageSender;

  beforeAll(async () => {
    t = await createTestWorker(provider);
    // deliver() is called directly; no jobs are queued, so the BullMQ worker stays idle.
    sender = t.module.get(MessageSender);
  });

  beforeEach(async () => {
    await resetState(t);
    provider.send.mockReset();
    provider.send.mockImplementation((email) =>
      Promise.resolve({ providerMessageId: `fake-${email.messageId}` }),
    );
  });

  afterAll(async () => {
    await t.module.close();
  });

  it('sends a queued message and records it as sent', async () => {
    const message = await createMessage(t.prisma);

    const outcome = await sender.deliver(message.id);

    expect(outcome).toEqual({ result: 'sent', providerMessageId: `fake-${message.id}` });
    expect(provider.send).toHaveBeenCalledWith({
      messageId: message.id,
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    const stored = await t.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.status).toBe(MessageStatus.sent);
    expect(stored.attempts).toBe(1);
    expect(stored.providerMessageId).toBe(`fake-${message.id}`);
    expect(stored.sentAt).toBeInstanceOf(Date);
    expect(stored.lastError).toBeNull();
  });

  it('passes a null text through when the message has none', async () => {
    const message = await createMessage(t.prisma, { text: null });

    await sender.deliver(message.id);

    expect(provider.send.mock.calls[0]?.[0].text).toBeNull();
  });

  it('sends a message left in sending by an interrupted attempt, counting the attempt', async () => {
    const message = await createMessage(t.prisma, { status: MessageStatus.sending, attempts: 1 });

    const outcome = await sender.deliver(message.id);

    expect(outcome.result).toBe('sent');
    const stored = await t.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.status).toBe(MessageStatus.sent);
    expect(stored.attempts).toBe(2);
  });

  it.each([MessageStatus.failed, MessageStatus.sent])(
    'skips a message that is already %s, without sending or changing it',
    async (status) => {
      const message = await createMessage(t.prisma, { status, lastError: 'earlier' });

      const outcome = await sender.deliver(message.id);

      expect(outcome).toEqual({ result: 'skipped', reason: 'not_sendable', status });
      expect(provider.send).not.toHaveBeenCalled();
      const stored = await t.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(stored).toEqual(message);
    },
  );

  it('skips a message that no longer exists', async () => {
    const outcome = await sender.deliver(randomUUID());

    expect(outcome).toEqual({ result: 'skipped', reason: 'not_found' });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('marks the message failed with the error, then rethrows', async () => {
    const message = await createMessage(t.prisma);
    provider.send.mockRejectedValueOnce(new Error('550 Mailbox unavailable'));

    await expect(sender.deliver(message.id)).rejects.toThrow('550 Mailbox unavailable');

    const stored = await t.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.status).toBe(MessageStatus.failed);
    expect(stored.attempts).toBe(1);
    expect(stored.lastError).toBe('Error: 550 Mailbox unavailable');
    expect(stored.sentAt).toBeNull();
    expect(stored.providerMessageId).toBeNull();
  });

  it('does not send a message again once it has failed', async () => {
    const message = await createMessage(t.prisma);
    provider.send.mockRejectedValueOnce(new Error('timeout'));
    await expect(sender.deliver(message.id)).rejects.toThrow();

    const second = await sender.deliver(message.id);

    expect(second).toEqual({
      result: 'skipped',
      reason: 'not_sendable',
      status: MessageStatus.failed,
    });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('uses the header name the providers send', () => {
    expect(MESSAGE_ID_HEADER).toBe('X-Neuron-Message-Id');
  });
});
