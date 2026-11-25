# Progress

Where Neuron's build stands, so work can be picked up at any time. The plan and its decisions are in [`docs/neuron-phase-1-plan.md`](docs/neuron-phase-1-plan.md); the workflow rules are in [`CLAUDE.md`](CLAUDE.md).

**Last updated:** 2026-11-25
**Now:** step 4 is in review ([PR #4](https://github.com/RChaubey16/neuron/pull/4)). Step 5 starts once it's merged.

## Build order

| #   | Feature                                               | Status      | PR                                                |
| --- | ----------------------------------------------------- | ----------- | ------------------------------------------------- |
| 1   | Monorepo, Turborepo, Docker Compose                   | Merged      | [#1](https://github.com/RChaubey16/neuron/pull/1) |
| 2   | Prisma schema, Google sign-in, API key auth           | Merged      | [#2](https://github.com/RChaubey16/neuron/pull/2) |
| 3   | `POST /v1/emails` queues messages                     | Merged      | [#3](https://github.com/RChaubey16/neuron/pull/3) |
| 4   | Worker sends through Mailpit and updates status       | In review   | [#4](https://github.com/RChaubey16/neuron/pull/4) |
| 5   | Resend provider, Dockerfiles, first deploy to Coolify | Not started |                                                   |
| 6   | `GET /v1/emails/:id` and idempotency                  | Not started |                                                   |
| 7   | Retries, backoff, dead-letter state, message events   | Not started |                                                   |
| 8   | Rate limiting                                         | Not started |                                                   |
| 9   | React Email templates with typed variables            | Not started |                                                   |
| 10  | Next.js dashboard                                     | Not started |                                                   |
| 11  | README with architecture diagram, test gaps           | Not started |                                                   |

Branch names and commit messages for each step are in the plan's build order.

## What works today

- **Monorepo:** pnpm workspaces and Turborepo. `pnpm check` runs format, lint, typecheck and tests across `apps/api`, `apps/web`, `packages/core` and `packages/db`.
- **Local stack:** Docker Compose with Postgres 19, Redis 8 and Mailpit, bound to localhost.
- **Google sign-in:** tested end to end with a real Google account. Sessions are a 7-day JWT cookie. `ALLOWED_EMAILS` is checked on every request.
- **API keys:** create, list and revoke from the dashboard API. Keys are stored as a SHA-256 hash and a display prefix. `GET /v1/me` checks a key.
- **Sending:** `POST /v1/emails` stores the message and queues a job, and answers 503 quickly if Redis is down.
- **Worker:** `apps/worker` takes jobs from the queue and sends through SMTP (Mailpit locally), then records `sent` with the provider's ID, or `failed` with the error. It skips messages that aren't `queued` or `sending`, sends emails queued while it was down as soon as it starts, and finishes in-flight jobs on SIGTERM. Tested end to end with real API → Redis → worker → Mailpit.
- **Health:** `GET /health` checks Postgres and Redis.

## Carried forward

Things earlier steps left for later steps. Tick them off as they're handled.

- [x] **Step 4:** the worker must skip any message that isn't `queued` or `sending`. A job can exist for a message the API already marked `failed` (Redis accepted the job after the API's 5-second timeout).
- [x] **Step 4:** the worker needs `ioredis` and `@neuron/db`, as the API does. Queue name, job name and payload type are in `packages/core` (`EMAIL_QUEUE`, `SEND_EMAIL_JOB`, `SendEmailJobData`).
- [ ] **Step 5:** `ResendProvider` implements `EmailProvider` in `apps/worker/src/email/`; add `resend` to `EmailProviderName` and the factory in `email.module.ts`.
- [ ] **Step 5:** the worker has no HTTP server, but the plan wants a health check Coolify can use. Decide how (e.g. a tiny health endpoint, or a Docker `HEALTHCHECK` command).
- [ ] **Step 5:** give the worker container a stop grace period, so it can finish in-flight emails after SIGTERM. It exits with code 143 after a clean stop, which is normal for NestJS.
- [ ] **Step 5:** use Node 24 in the Docker images. Prisma 7 warns that Node 26 isn't supported.
- [ ] **Step 5:** add `https://api.<domain>/auth/google/callback` as a second redirect URI on the Google OAuth client, and set `COOKIE_DOMAIN` (e.g. `.<domain>`) in production.
- [ ] **Step 5:** run `prisma migrate deploy` when the API container starts.
- [ ] **Step 7:** today a failed send marks the message `failed` at once and the job isn't retried. Step 7 keeps the message in `sending` between attempts, marks it `failed` only when retries run out or the error is permanent (e.g. SMTP 5xx), and records each attempt in `message_events`.
- [ ] **Step 7:** delivery is at-least-once. If a worker dies after the provider accepted an email but before the status update, BullMQ re-runs the stalled job and the email is sent twice. Consider whether that needs handling (e.g. a provider idempotency key with Resend).
- [ ] **Step 9:** add `templateId` and `variables` to `POST /v1/emails` and the `messages` table.
- [ ] **Step 10:** the dashboard needs a `/sign-in` page that handles `?error=<code>` (`access_denied`, `google_error`, `invalid_state`, `invalid_request`, `email_not_verified`, `not_allowed`, `server_error`).

## Decisions made while building

Changes or additions to the plan, and why. Each is also explained in its PR.

| Step | Decision                                                                    | Why                                                                                         |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1    | TypeScript 6.0 and ESLint 9, not 7 and 10                                   | typescript-eslint and `eslint-config-next`'s plugins don't support the newer versions yet   |
| 2    | `packages/db` holds the Prisma schema, migrations and client                | Shared by the API and worker; kept out of `packages/core` so the dashboard never bundles it |
| 2    | `google-auth-library` instead of Passport                                   | Passport's Google strategy needs a server-side session store to check the OAuth `state`     |
| 2    | Prisma 7.10.1                                                               | npm's `latest` tag points at an 8.0 release candidate                                       |
| 2    | API keys hashed with SHA-256, not bcrypt                                    | Keys have 256 bits of entropy; a fast hash allows an indexed lookup per request             |
| 3    | Raw HTML only until step 9; one recipient per message                       | No stub for templates; one clear status per message                                         |
| 3    | `ioredis` added alongside BullMQ 6                                          | BullMQ 6 no longer bundles a Redis client                                                   |
| 4    | nodemailer 10 with `@types/nodemailer` 8                                    | No types ship with nodemailer 10; its changelog says it keeps the `@types` layout working   |
| 4    | Each app's tests get their own Postgres database and Redis DB number        | Turborepo runs the API and worker test suites at the same time                              |
| 4    | A message is claimed with a conditional update (`queued` or `sending` only) | Skips messages already failed or sent, in the same query that counts the attempt            |

## Picking the work up again

1. Read this file, then the open PR (if any) and its comments.
2. Start the local stack and check it's healthy:
   ```sh
   git checkout main && git pull
   pnpm install
   pnpm infra:up
   pnpm --filter @neuron/db db:deploy
   pnpm check
   ```
3. Continue with the next step in the table, following the cycle in `CLAUDE.md`.

## Local machine notes

- DDEV's router uses port 8025, so the local `.env` sets `MAILPIT_UI_PORT=8027`. The Mailpit inbox is at http://localhost:8027.
- The local `.env` has real Google OAuth credentials and isn't committed. `.env.example` lists every variable.
