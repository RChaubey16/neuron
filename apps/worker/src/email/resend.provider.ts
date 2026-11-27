import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { DeliveryResult } from '../channels/channel.js';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { MESSAGE_ID_HEADER, type EmailProvider, type OutgoingEmail } from './email-provider.js';

/** A request to Resend that hasn't answered by then is abandoned and the job fails. */
export const RESEND_TIMEOUT_MS = 30_000;

/** An error answer from the Resend API, with its HTTP status and Resend's error code. */
export class ResendApiError extends Error {
  override readonly name = 'ResendApiError';

  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Sends email through the Resend API. Used in production.
 *
 * Each email is sent with Neuron's message ID as Resend's idempotency key, so
 * if a job runs again for a message Resend already accepted (a worker crashed
 * before recording `sent`), Resend returns the first email instead of sending
 * a second one. Resend keeps idempotency keys for 24 hours.
 */
@Injectable()
export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly client: Resend;
  /** Overridable so tests don't wait 30 seconds. */
  protected readonly timeoutMs: number = RESEND_TIMEOUT_MS;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    // Validated as required when EMAIL_PROVIDER=resend.
    this.client = new Resend(config.get('RESEND_API_KEY', { infer: true }));
  }

  async send(email: OutgoingEmail): Promise<DeliveryResult> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    const { data, error } = await this.client.emails.send(
      {
        from: email.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text ?? undefined,
        headers: { [MESSAGE_ID_HEADER]: email.messageId },
      },
      {
        idempotencyKey: `neuron-message/${email.messageId}`,
        signal,
      },
    );

    if (error) {
      // The SDK reports a timeout like any network failure, so check the signal.
      if (signal.aborted) {
        throw new ResendApiError(
          `Resend did not answer within ${this.timeoutMs}ms`,
          null,
          'timeout',
        );
      }
      const message =
        error.statusCode === null
          ? `Could not reach Resend: ${error.message}`
          : `Resend rejected the email (${error.statusCode} ${error.name}): ${error.message}`;
      throw new ResendApiError(message, error.statusCode, error.name);
    }
    return { providerMessageId: data.id };
  }
}
