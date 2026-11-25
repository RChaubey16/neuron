import { Injectable, Logger } from '@nestjs/common';
import { MessageStatus } from '@neuron/db';
import { EmailChannel } from '../email/email.channel.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Statuses a message can be sent from. `sending` covers a retry of an interrupted attempt. */
const SENDABLE: MessageStatus[] = [MessageStatus.queued, MessageStatus.sending];

/** lastError is for people reading the dashboard; cap it so a huge error can't bloat the row. */
const MAX_ERROR_LENGTH = 1_000;

export type DeliveryOutcome =
  | { result: 'sent'; providerMessageId: string }
  | { result: 'skipped'; reason: 'not_found' }
  | { result: 'skipped'; reason: 'not_sendable'; status: MessageStatus };

export function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
}

@Injectable()
export class MessageSender {
  private readonly logger = new Logger(MessageSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailChannel,
  ) {}

  /**
   * Sends one message and records the result.
   *
   * Skips messages that no longer exist, and messages that aren't queued or
   * sending: one the API marked failed because queueing timed out, or one
   * already sent. Throws if the provider doesn't accept the email, after
   * marking the message failed.
   */
  async deliver(messageId: string): Promise<DeliveryOutcome> {
    // Claim the message and count the attempt in one conditional update, so a
    // message that isn't sendable is never sent.
    const claimed = await this.prisma.message.updateMany({
      where: { id: messageId, status: { in: SENDABLE } },
      data: { status: MessageStatus.sending, attempts: { increment: 1 } },
    });

    if (claimed.count === 0) {
      const existing = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { status: true },
      });
      return existing
        ? { result: 'skipped', reason: 'not_sendable', status: existing.status }
        : { result: 'skipped', reason: 'not_found' };
    }

    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId } });

    let providerMessageId: string;
    try {
      ({ providerMessageId } = await this.email.deliver(message));
    } catch (error) {
      await this.prisma.message.updateMany({
        where: { id: messageId, status: MessageStatus.sending },
        data: { status: MessageStatus.failed, lastError: describeError(error) },
      });
      throw error;
    }

    const recorded = await this.prisma.message.updateMany({
      where: { id: messageId, status: MessageStatus.sending },
      data: {
        status: MessageStatus.sent,
        providerMessageId,
        sentAt: new Date(),
        lastError: null,
      },
    });
    if (recorded.count === 0) {
      // Only possible if something else changed the status mid-send.
      this.logger.warn(`Message ${messageId} was sent but its status had already changed`);
    }

    return { result: 'sent', providerMessageId };
  }
}
