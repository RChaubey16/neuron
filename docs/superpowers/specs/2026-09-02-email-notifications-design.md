# Notifications Service — Email (Phase 5)

## Context

Neuron has two service modules live so far, both following the same
`Module + Controller + Service + ApiKeyGuard` pattern: nothing yet, since
`ShortUrlModule` (Phase 6) was built ahead of Phase 5. This spec builds
the first — email notifications — completing Phase 5 of the development
plan. SMS notifications are explicitly out of scope; they're a separate
Phase 9 backlog item.

Sending is queue-based (BullMQ + the Redis instance already defined in
`docker-compose.yml`, currently unused by any code) so the request/response
cycle never blocks on a call to the email provider. Delivery is
fire-and-forget from the API's perspective — no delivery-status table or
status-check endpoint; failures after retries are exhausted surface only
in structured logs, matching this project's existing hardening posture
(YAGNI — add tracking later if a real caller needs it).

## Goal

An authenticated caller `POST`s to `/api/v1/notifications/email` with
recipients/subject/body and an `x-api-key`, gets a fast `202 Accepted`
once the job is queued, and the email actually arrives via Resend shortly
after — with retries handling transient Resend failures automatically.

## Flow

```
Caller  → POST /api/v1/notifications/email
          { to: string[], subject: string, body: string }
          x-api-key: <raw key>
        → ApiKeyGuard authenticates, UsageLoggingInterceptor logs the call
        → ValidationPipe rejects malformed payloads (400)
        → NotificationsController.send()
        → NotificationsService.queueEmail(dto)
        → BullMQ 'email' queue .add('send', dto, { attempts: 3, backoff: exponential })
        → 202 Accepted { queued: true } returned immediately

(async, outside the request lifecycle)
BullMQ  → EmailProcessor.process(job)
        → Resend SDK: resend.emails.send({ from: RESEND_FROM_EMAIL, to, subject, html: body })
        → success: StructuredLogger.log at 'log' level with job id
        → failure: StructuredLogger.error, rethrow → BullMQ retries (up to 3 attempts)
        → after 3 exhausted attempts: job sits in BullMQ's failed set, no app-level surface
```

## Components

### New

- **`src/notifications/notifications.module.ts`** — `NotificationsModule`,
  same shape as `ShortUrlModule`: imports `UsageModule` + `ApiKeyModule`
  explicitly (for `ApiKeyGuard`/`UsageLoggingInterceptor` resolution
  documentation, matching this repo's existing convention even though
  Nest would resolve them globally regardless), registers
  `BullModule.registerQueue({ name: 'email' })`, declares
  `NotificationsController` + `NotificationsService` + `EmailProcessor`.
- **`src/notifications/notifications.controller.ts`** —
  `POST api/v1/notifications/email`, `@HttpCode(HttpStatus.ACCEPTED)`,
  `@UseGuards(ApiKeyGuard)`, `@Service('email-notifications')`,
  `@UseInterceptors(UsageLoggingInterceptor)`,
  `@Throttle({ default: { limit: 10, ttl: 60_000 } })` (same limit as
  `POST /shorten`, since both are cost-bearing writes). Handler calls
  `notificationsService.queueEmail(dto)` and returns `{ queued: true }`.
- **`src/notifications/notifications.service.ts`** —
  `NotificationsService.queueEmail(dto: CreateEmailDto)`: injects the
  BullMQ `email` queue (`@InjectQueue('email')`), calls
  `queue.add('send', dto, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })`.
  No validation logic of its own — the DTO's `class-validator` decorators
  handle that before this method ever runs.
- **`src/notifications/email.processor.ts`** — `EmailProcessor extends
  WorkerHost` (`@nestjs/bullmq`), `@Processor('email')`. `process(job: Job<CreateEmailDto>)`
  calls the injected Resend client's `emails.send(...)`; throws on
  failure so BullMQ's own retry/backoff (configured on the job, not the
  processor) takes over. This is the only piece of the module that talks
  to the network, kept isolated from the controller/service so it can be
  unit-tested independently with a mocked Resend client.
- **`src/notifications/dto/create-email.dto.ts`** — `CreateEmailDto`:
  `to: string[]` (`@IsArray()`, `@ArrayNotEmpty()`, `@IsEmail({}, { each: true })`),
  `subject: string` (`@IsString()`, `@IsNotEmpty()`), `body: string`
  (`@IsString()`, `@IsNotEmpty()` — raw HTML/text, sent as-is, no
  templating).
- **`src/config/resend.provider.ts`** (or inline in `NotificationsModule`)
  — a factory provider constructing `new Resend(configService.getOrThrow('RESEND_API_KEY'))`,
  injected into `EmailProcessor`.
- **`BullModule.forRootAsync`** registered once in `AppModule`, connection
  from `configService.getOrThrow('REDIS_HOST')` /
  `configService.getOrThrow('REDIS_PORT')`.
- **New required env vars** (added to `src/config/env.validation.ts` and
  `.env.example`): `REDIS_HOST`, `REDIS_PORT` (`@IsInt() @Min(1)`),
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (`@IsEmail()`). `docker-compose.yml`
  already runs a `redis` service reachable at host `redis`, port `6379` —
  no compose changes needed, just wiring the app to use it for the first
  time.
- **`.github/workflows/ci.yml`** — the `lint-and-build` job's existing
  hardcoded-dummy-env-var block gains `REDIS_HOST`/`REDIS_PORT`/
  `RESEND_API_KEY`/`RESEND_FROM_EMAIL`, same treatment as every prior
  required env var. Unit tests mock the BullMQ queue and Resend client, so
  CI never opens a real connection to either.
- **`AppModule`** — `NotificationsModule` added as an import, positioned
  before `ShortUrlModule` (which must stay the last import per the
  existing routing-order gotcha; `NotificationsModule`'s routes are all
  static/`POST`, so ordering relative to everything except `ShortUrlModule`
  doesn't matter).

### New dependencies

- `@nestjs/bullmq`, `bullmq` — queue.
- `resend` — official Resend SDK.

### Unchanged

- `ApiKeyGuard`, `UsageLoggingInterceptor`, `Service` decorator,
  `GlobalExceptionFilter`, `StructuredLogger`, API versioning convention
  and its regression test (`src/common/api-versioning.spec.ts` — this
  route is `ApiKeyGuard`-protected, so it must stay under `/api/v1/...`;
  no change to that spec's logic, just one more route it now covers).

## Error handling

- Malformed request body → `400` via the existing global `ValidationPipe`
  (`whitelist: true`, `forbidNonWhitelisted: true`), before anything
  reaches the queue.
- Resend API failure inside `EmailProcessor` → caught, logged at `error`
  via `StructuredLogger` (tagged with the BullMQ job ID, not a request
  correlation ID — this runs outside the HTTP request lifecycle and
  `RequestIdMiddleware`'s `AsyncLocalStorage` context doesn't extend to
  queue workers), rethrown so BullMQ's configured `attempts`/`backoff`
  retries it. After 3 exhausted attempts the job is marked failed and
  remains inspectable via BullMQ/Redis tooling (e.g. `redis-cli`) — no
  app-level status surface, per the fire-and-forget decision.
- `NotificationsService.queueEmail` itself has no failure mode worth
  handling beyond what `queue.add()` already throws on (e.g. Redis being
  down) — that error propagates normally through `GlobalExceptionFilter`
  as a `500`, same as any other unexpected exception.

## Testing

- `src/notifications/notifications.service.spec.ts` — mocks the injected
  BullMQ queue, asserts `queueEmail` calls `.add('send', dto, { attempts: 3, ... })`
  with the exact job data and options.
- `src/notifications/email.processor.spec.ts` — mocks the Resend client,
  asserts `process()` calls `emails.send` with the right payload on
  success, and that a thrown Resend error propagates out of `process()`
  (so BullMQ's retry sees it) rather than being swallowed.
- One e2e happy-path test (`test/notifications.e2e-spec.ts`, mirroring the
  existing `test/short-url.e2e-spec.ts` style) — `POST /api/v1/notifications/email`
  with a mocked Resend client and a real (in-memory or test-instance)
  queue, asserting `202` and that a job lands on the `email` queue.
- Manual end-to-end verification via `docker compose up` (per this
  project's standing preference for Docker-based verification): send a
  real email through Resend to a real inbox and confirm it arrives;
  confirm `GET /health` and the versioning regression test still pass
  with the new module wired in.

## Out of scope

- SMS notifications (Phase 9 backlog).
- Delivery-status tracking / a `GET` status endpoint.
- Templating (Resend templates, React Email, etc.) — `body` is raw
  HTML/text passed through as-is.
- Per-API-key rate limiting (still explicitly Phase 7's unfinished item;
  this route gets the same IP-based `@Throttle()` treatment as
  `POST /shorten`, nothing more).
