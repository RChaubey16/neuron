import type { DeliveryResult } from '../channels/channel.js';

/** An email ready to hand to a provider. */
export interface OutgoingEmail {
  /** Neuron's message ID, sent as the X-Neuron-Message-Id header for tracing. */
  messageId: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string | null;
}

/**
 * A service that actually sends email: SMTP (Mailpit locally) or Resend
 * (production). EMAIL_PROVIDER picks one at startup.
 */
export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<DeliveryResult>;
  /** Releases connections when the worker shuts down. */
  close?(): void;
}

/** Injection token for the configured EmailProvider. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** Header carrying Neuron's message ID on every email. */
export const MESSAGE_ID_HEADER = 'X-Neuron-Message-Id';
