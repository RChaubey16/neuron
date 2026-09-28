# Outgoing webhooks — design

## Goal

Let an app that uses Neuron learn about things that happen inside Neuron
(an email it queued was sent, or permanently failed) without polling
`GET /api/v1/notifications/email/:jobId`. The app registers an HTTPS
endpoint and subscribes it to event types; Neuron POSTs a signed JSON
payload to it, retrying on failure, and keeps a delivery log the owner can
inspect and retry from the dashboard.

This is "Neuron events" webhooks (Stripe/Resend style), not a generic
"deliver this payload for me" relay — Neuron decides when a webhook fires.

## Events (v1)

| Type | Fires when |
|---|---|
| `email.sent` | `EmailProcessor`'s `completed` handler marks an `EmailJob` `SENT` |
| `email.failed` | `EmailProcessor`'s `failed` handler marks an `EmailJob` `FAILED` after its last attempt (not on an intermediate, still-retrying failure) |
| `webhook.test` | The owner clicks "Send test event" — sent to that one endpoint only, whether or not it subscribes to anything; not subscribable |

`short_url.clicked` is deliberately out of v1: `GET /:code` is public and
unauthenticated, so anyone could turn clicks into a webhook flood against
the owner's endpoint. It can come later, batched or sampled.

A dashboard retry of a `FAILED` email that then succeeds emits `email.sent`
after the earlier `email.failed` — each is a real, separate state change.

## Ownership

Endpoints belong to a **user**, not an API key: events from jobs created by
any of the user's keys (or the dashboard) fan out to every matching
endpoint. Each payload carries the originating `apiKeyId` (or `null` for a
dashboard-native call) so a receiver can filter. Machine routes therefore
scope by the calling key's `userId`, same as the dashboard routes scope by
the logged-in user — unlike email's machine routes, which scope by
`apiKeyId`.

## Data model

- `WebhookEndpoint` — `userId`, `url`, `description?`, `events String[]`,
  `secret`, `disabledAt?`, `deletedAt?` (soft delete, so deliveries keep
  their endpoint). Max 10 live endpoints per user.
- `WebhookDelivery` — one row per (event, endpoint): `endpointId`,
  `userId`, `eventType`, `payload Json`, `status`
  (`PENDING`/`SUCCEEDED`/`FAILED`), `attemptsMade`, `responseStatus?`,
  `error?`, `lastAttemptAt?`. Its `id` is the BullMQ job id and the
  `webhook-id` header, stable across retries so receivers can dedupe.

**The secret is stored in plaintext.** Unlike an API key it can't be
hashed — Neuron needs the secret itself to compute each signature. It's
returned once on creation and on rotation (`POST .../rotate-secret`), never
by list/get, mirroring the API-key UX.

## Delivery

- A `webhook` BullMQ queue, producer built on `PRODUCER_REDIS` (token
  `WEBHOOK_QUEUE`), same reasoning as `EMAIL_QUEUE`. Job data is just
  `{ deliveryId }`; `WebhookProcessor` loads the delivery + endpoint on each
  attempt, so a rotated secret, edited URL, or deleted/disabled endpoint
  takes effect on the next retry.
- 6 attempts, exponential backoff from 30s (≈30s, 1m, 2m, 4m, 8m).
- One POST per attempt, 10s timeout, redirects not followed. Any 2xx is
  success; anything else throws so BullMQ retries.
- Status is written **inside `process()`**, not from worker events: each
  attempt's outcome is known there (`job.attemptsMade + 1 >= attempts`
  tells a final failure apart), and the write is awaited in order, so
  there's none of `EmailProcessor`'s out-of-order listener race.
- A deleted/disabled endpoint or a blocked target marks the delivery
  `FAILED` and throws BullMQ's `UnrecoverableError`, skipping retries.
- If the queue add fails (Redis down), the delivery row is marked `FAILED`
  ("Could not be queued for delivery") and stays retryable.
- `WebhooksService.emit()` never throws — webhook fan-out must not break
  the email pipeline that triggers it.

## Signing — Standard Webhooks

Follows <https://www.standardwebhooks.com/>, so receivers can verify with
off-the-shelf libraries:

- Secret: `whsec_` + base64 of 24 random bytes.
- Headers: `webhook-id` (delivery id), `webhook-timestamp` (unix seconds,
  of *this attempt*), `webhook-signature: v1,<base64 HMAC-SHA256>` over
  `${id}.${timestamp}.${body}`, keyed with the base64-decoded secret.
- Body: `{ "type": "email.sent", "timestamp": "<ISO>", "data": { ... } }`.

## SSRF protection

- At create/update: URL must be `https`, and its host can't be `localhost`
  or a private/loopback/link-local IP literal.
- At delivery: the request goes through `https.request` with a custom
  `lookup` that rejects any resolved private/loopback/link-local/CGNAT
  address. Checking the address actually connected to (not a separate
  pre-flight lookup) closes the DNS-rebinding gap.
- `WEBHOOKS_ALLOW_PRIVATE_TARGETS=true` (optional, default off) disables
  both checks and allows `http`, for local development against a receiver
  on `localhost`. Never set it in production.

## Routes

Machine (`ApiKeyGuard`, `/api/v1/webhooks/...`) and dashboard
(`JwtAuthGuard`, `/webhooks/...`) pairs, same DTOs and service methods,
`@Service('webhooks')` for usage logging:

| Method | Path (after prefix) | |
|---|---|---|
| `POST` | `endpoints` | create; returns the secret once |
| `GET` | `endpoints` | list |
| `GET` | `endpoints/:endpointId` | get |
| `PATCH` | `endpoints/:endpointId` | update url/description/events/enabled |
| `DELETE` | `endpoints/:endpointId` | soft delete |
| `POST` | `endpoints/:endpointId/rotate-secret` | returns the new secret once |
| `POST` | `endpoints/:endpointId/test` | queue a `webhook.test` delivery |
| `GET` | `deliveries?endpointId=&limit=&offset=` | paginated log |
| `POST` | `deliveries/:deliveryId/retry` | re-queue a `FAILED` delivery |

## Dashboard

A "Webhooks" item in the sidebar's "Services" group: an endpoint list with
create (secret shown once), enable/disable, rotate secret, send test,
delete (`AlertDialog`), and a delivery log with Retry on failed rows.
