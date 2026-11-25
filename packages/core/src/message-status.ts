/**
 * Lifecycle of a message, as decided in docs/neuron-phase-1-plan.md:
 *
 * - `queued`:  accepted by the API and waiting in the queue.
 * - `sending`: a worker is attempting it. It stays here between retries.
 * - `sent`:    the provider accepted it and returned its own message ID.
 * - `failed`:  all retries used up, or a permanent error. Dead-lettered.
 */
export const MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'failed'] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Statuses a message never leaves. */
export const TERMINAL_MESSAGE_STATUSES: readonly MessageStatus[] = ['sent', 'failed'];

const ALLOWED_TRANSITIONS: Readonly<Record<MessageStatus, readonly MessageStatus[]>> = {
  queued: ['sending', 'failed'],
  sending: ['sent', 'failed'],
  sent: [],
  failed: [],
};

export function isMessageStatus(value: unknown): value is MessageStatus {
  return typeof value === 'string' && (MESSAGE_STATUSES as readonly string[]).includes(value);
}

export function isTerminalMessageStatus(status: MessageStatus): boolean {
  return TERMINAL_MESSAGE_STATUSES.includes(status);
}

/**
 * Whether a message may move from one status to another. Staying in `sending`
 * between retries is not a transition, so `sending -> sending` is rejected.
 */
export function canTransitionMessageStatus(from: MessageStatus, to: MessageStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
