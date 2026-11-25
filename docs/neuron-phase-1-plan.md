# Neuron: Phase 1 Plan

Neuron is a notification system. Phase 1 covers email; SMS comes in phase 2.

## Why this project

- It fills the real gap: your TS resume is weakest on Node/TypeScript backend work.
- It isn't another AI app. You already have Knowbase for that.
- Starting with email only keeps it small enough to finish, and it still shows queues, retries, an API contract and rate limiting.

## One change to your idea: rate-limit by API key, not server IP

- Callers on cloud, NAT or serverless hosts have changing or shared IPs.
- Give each client an API key and apply the rate limit to that key. Keep IP limits only as a backup against abuse.
- This is what Resend, SendGrid and Postmark do.

## Phase 1 scope

1. **API:** `POST /v1/emails` takes a template ID and variables, or raw HTML. It returns a message ID right away (`202 Accepted`). `GET /v1/emails/:id` returns the delivery status.
2. **Auth:** API keys, stored hashed in the database and sent as a Bearer token.
3. **Queue and worker:** BullMQ on Redis, with retries, exponential backoff and a failed-jobs (dead-letter) state.
4. **Idempotency:** `Idempotency-Key` header, so a client that retries doesn't send the same email twice.
5. **Default templates:** welcome, password reset, OTP/verification and a generic notification, built with React Email and typed variables.
6. **Rate limiting:** per API key, sliding window, stored in Redis.
7. **Message log:** each message with its status (see the data model below).
8. **Dashboard:** a small Next.js dashboard for API keys, template previews and the message log.

## Ready for SMS later (phase 2)

Define one `Channel` interface now and implement only `EmailChannel`. SMS then becomes a new adapter instead of a rewrite.

## Decisions

Decided on 2026-11-25.

### Accounts

- Users only, no projects or organizations.
- A user signs in to the dashboard and creates API keys. Each key belongs to one user.
- Messages belong to the user, and record which API key sent them.

### Dashboard sign-in: Google OAuth

- The NestJS API handles the sign-in, using Passport with the Google strategy (`passport-google-oauth20`). The auth logic stays in the backend, which is the part of the project this is meant to show off.
- After Google sign-in, the API sets a signed session token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie. The dashboard sends it with every request to the API.
- The dashboard and API sit on the same parent domain (e.g. `neuron.example.com` and `api.neuron.example.com`), so the cookie works for both.
- **Who can sign in:** only Google accounts listed in an `ALLOWED_EMAILS` environment variable. Without this, any Google user could sign up and send email from your Resend domain. Open sign-up can come later.

### Database: Prisma

Prisma on Postgres, for schema, migrations and queries.

### Validation: NestJS defaults

- `class-validator` and `class-transformer` DTOs with NestJS's global `ValidationPipe`.
- No Zod. `packages/core` shares plain TypeScript types (message status, template names and their variables, job payloads) between the API, worker and dashboard.

### Idempotency

- An `Idempotency-Key` is unique per API key, not across everyone.
- Keys are kept for 24 hours, then cleaned up.
- The same key with the same request body returns the original response (the same message ID), and no new email is sent.
- The same key with a different request body returns `422 Unprocessable Entity`.

### Rate limits

All limits are defaults set in config, so they can be changed without code changes.

| Limit                         | Default              | Why                                                                                   |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Requests per API key          | 60 per minute, sliding window | Stops a buggy client loop from flooding the queue.                           |
| Emails sent per user          | 500 per day          | Protects your Resend quota and your domain's sending reputation. Set it to your Resend plan's daily limit. |
| Requests per IP (backup)      | 300 per minute       | Catches abuse that rotates or guesses API keys.                                       |
| Failed auth attempts per IP   | 20 per minute        | Slows down attempts to guess API keys.                                                |

When a limit is hit, the API returns `429 Too Many Requests` with these headers:

- `Retry-After`: seconds until the client can try again.
- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`: also sent on successful responses, so clients can slow down before hitting the limit.

### Email provider: Resend

- `EmailChannel` sends through an `EmailProvider` interface.
- `ResendProvider` (Resend Node SDK) is used in production.
- `SmtpProvider` (nodemailer to Mailpit) is used in local development, so you don't need a Resend account or real sends while developing.
- The provider is chosen by an environment variable.
- The sender address is a fixed value from config in phase 1, on a domain verified in Resend.

### Message status

| Status    | Meaning                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| `queued`  | Accepted by the API and waiting in the queue.                                    |
| `sending` | A worker is attempting it. It stays here between retries.                        |
| `sent`    | The provider accepted it and returned its own message ID.                        |
| `failed`  | All retries used up, or a permanent error (e.g. invalid address). Dead-lettered. |

`delivered`, `bounced` and `complained` need Resend webhooks. They are left for later and can be added without changing these four.

### Data model

- **users**: `id`, `google_id` (unique), `email` (unique), `name`, `avatar_url`, `created_at`, `last_login_at`
- **api_keys**: `id`, `user_id`, `name`, `prefix` (first few characters, shown in the dashboard), `key_hash`, `last_used_at`, `revoked_at`, `created_at`
- **messages**: `id`, `user_id`, `api_key_id`, `to`, `from`, `subject`, `template_id` (nullable), `variables` (JSON, nullable), `html` (nullable), `status`, `attempts`, `provider_message_id`, `last_error`, `created_at`, `sent_at`
- **idempotency_keys**: `api_key_id`, `key`, `request_hash`, `message_id`, `expires_at`. Unique on (`api_key_id`, `key`).
- **message_events**: `id`, `message_id`, `type` (`queued`, `attempt_failed`, `sent`, `failed`), `attempt`, `error`, `created_at`. Gives the dashboard a timeline for each message and shows retries happening.

### Monorepo tooling: pnpm workspaces and Turborepo

- pnpm workspaces link the packages together.
- Turborepo runs tasks across them: it builds `packages/core` before the apps, runs all the dev servers with one command, and skips tasks whose inputs haven't changed.
- `turbo prune --docker` makes a cut-down copy of the monorepo with only what one app needs. Each Dockerfile builds from that, which keeps images small and builds cached.

### Deployment: Docker on your VPS via Coolify

- Each app (`api`, `worker`, `web`) has its own multi-stage Dockerfile, built from the `turbo prune` output and running as a non-root user.
- A `docker-compose.prod.yml` describes the three apps for Coolify. Postgres and Redis run as Coolify-managed databases, with Coolify's backups turned on for Postgres.
- Coolify's proxy handles HTTPS and the domains (`neuron.example.com` for the dashboard, `api.neuron.example.com` for the API). The worker has no public domain.
- Prisma migrations run with `prisma migrate deploy` when the API container starts, before it accepts traffic.
- Health checks: `GET /health` on the API (checks Postgres and Redis), and a health check on the worker, so Coolify can restart them if they hang.
- Secrets (Resend key, Google OAuth credentials, session secret, database URLs) are set as environment variables in Coolify, never in the repo.
- Mailpit is for local development only and is not deployed.

## Keeping it maintainable

- **Stack:** NestJS for the API, Next.js for the dashboard, a separate NestJS worker (`@nestjs/bullmq`), Postgres with Prisma, Redis and Resend.
- **Package manager:** pnpm, with pnpm workspaces and Turborepo.
- **Repo layout:** a monorepo with `apps/api` (NestJS), `apps/web` (Next.js dashboard), `apps/worker` and `packages/core`, so all three apps share types.
- **Local setup:** Docker Compose (Postgres, Redis, Mailpit), with Mailpit catching emails during development.
- **Docs and tests:** a README with an architecture diagram, and a few tests on the API and the worker.

## Build order

Each step ends with something that runs, and is one feature branch, one commit and one PR (see `CLAUDE.md`).

| #  | Feature | Branch | Commit message |
| -- | ------- | ------ | -------------- |
| 1  | Monorepo (pnpm workspaces and Turborepo) and Docker Compose with Postgres, Redis and Mailpit. | `feature/monorepo-setup` | `chore: set up monorepo with pnpm workspaces, Turborepo and Docker Compose` |
| 2  | Prisma schema, Google sign-in and API key auth. | `feature/auth-and-api-keys` | `feat: add Prisma schema, Google sign-in and API key auth` |
| 3  | `POST /v1/emails` writes the message and adds a job to the queue. | `feature/send-email-endpoint` | `feat: add POST /v1/emails endpoint that queues messages` |
| 4  | The worker sends through `SmtpProvider` to Mailpit and updates the status. | `feature/email-worker` | `feat: add email worker with SMTP provider and status updates` |
| 5  | `ResendProvider`, Dockerfiles and the first deploy to Coolify. | `feature/resend-and-deploy` | `feat: add Resend provider and Docker images for Coolify deploy` |
| 6  | `GET /v1/emails/:id` and idempotency. | `feature/status-and-idempotency` | `feat: add message status endpoint and Idempotency-Key support` |
| 7  | Retries, backoff, the dead-letter state and message events. | `feature/retries-and-events` | `feat: add retries with backoff, dead-letter state and message events` |
| 8  | Rate limiting. | `feature/rate-limiting` | `security: add per-key, per-user and per-IP rate limiting` |
| 9  | React Email templates with typed variables. | `feature/email-templates` | `feat: add React Email templates with typed variables` |
| 10 | Next.js dashboard: sign-in, API keys, template previews and the message log. | `feature/dashboard` | `feat: add Next.js dashboard for API keys, templates and message log` |
| 11 | README with the architecture diagram, and tests. | `feature/docs-and-tests` | `docs: add README with architecture diagram and fill test gaps` |

Every feature still ships with its own tests (per the completion checklist). Step 11 fills any gaps and adds end-to-end coverage, not the first tests.

The first deploy comes early on purpose. Once one email goes out through Resend from the VPS, anything that only breaks in Docker or production shows up straight away, and every later step is deployed as you go.
