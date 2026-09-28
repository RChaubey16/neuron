/**
 * Event types an endpoint can subscribe to. Each is emitted by the module
 * that owns the underlying state change, via `WebhooksService.emit`.
 */
export const SUBSCRIBABLE_WEBHOOK_EVENTS = [
  'email.sent',
  'email.failed',
] as const;

export type SubscribableWebhookEvent =
  (typeof SUBSCRIBABLE_WEBHOOK_EVENTS)[number];

/** Sent only by "Send test event", to one endpoint regardless of its subscriptions. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

export type WebhookEventType =
  SubscribableWebhookEvent | typeof WEBHOOK_TEST_EVENT;
