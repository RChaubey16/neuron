import type { Message } from '@neuron/db';

/** What a provider reports back once it has accepted a message. */
export interface DeliveryResult {
  /** The provider's own ID for the message, kept for support and webhooks. */
  providerMessageId: string;
}

/**
 * A way of delivering a message to a person. Phase 1 has one, EmailChannel;
 * SMS in phase 2 becomes a second implementation rather than a rewrite.
 */
export interface Channel {
  readonly name: string;
  /** Hands the message to the provider. Throws if the provider doesn't accept it. */
  deliver(message: Message): Promise<DeliveryResult>;
}
