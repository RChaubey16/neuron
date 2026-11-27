# Progress

Where Neuron's build stands, so work can be picked up at any time. The plan and its decisions are in [`docs/neuron-phase-1-plan.md`](docs/neuron-phase-1-plan.md); the workflow rules are in [`CLAUDE.md`](CLAUDE.md).

**Last updated:** 2026-11-27
**Now:** step 5 is merged and deployed at https://neuron.ruturaj.xyz and https://api.neuron.ruturaj.xyz. [PR #6](https://github.com/RChaubey16/neuron/pull/6) (a fix, not a build step) joins the API and worker to Coolify's database network so it survives redeploys. Still to check: sign-in, an API key and a real Resend send in production. Step 6 starts after that.

## Build order

| #   | Feature                                               | Status      | PR                                                |
| --- | ----------------------------------------------------- | ----------- | ------------------------------------------------- |
| 1   | Monorepo, Turborepo, Docker Compose                   | Merged      | [#1](https://github.com/RChaubey16/neuron/pull/1) |
| 2   | Prisma schema, Google sign-in, API key auth           | Merged      | [#2](https://github.com/RChaubey16/neuron/pull/2) |
| 3   | `POST /v1/emails` queues messages                     | Merged      | [#3](https://github.com/RChaubey16/neuron/pull/3) |
| 4   | Worker sends through Mailpit and updates status       | Merged      | [#4](https://github.com/RChaubey16/neuron/pull/4) |
| 5   | Resend provider, Dockerfiles, first deploy to Coolify | Merged      | [#5](https://github.com/RChaubey16/neuron/pull/5) |
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
- **Resend:** `EMAIL_PROVIDER=resend` sends through the Resend API with the message ID as the idempotency key, a 30-second timeout, and errors that carry Resend's status and code. Tested against a fake Resend API; not yet against the real one.
- **Docker:** one image per app (`apps/*/Dockerfile`, Node 24 Alpine, `turbo prune`, non-root, with a `HEALTHCHECK`). The API image runs `prisma migrate deploy` before starting. Tested locally: all three containers healthy, migrations applied to an empty database, an email sent through the API and worker containers to Mailpit, and a clean worker stop with jobs in flight.
- **Deploy files:** `docker-compose.prod.yml` for Coolify and the setup guide in `docs/deploy.md`.
- **Health:** `GET /health` on the API checks Postgres and Redis; the worker's `GET /health` (port 4001, internal) also checks that the BullMQ worker is running.

## Carried forward

Things earlier steps left for later steps. Tick them off as they're handled.

- [x] **Step 4:** the worker must skip any message that isn't `queued` or `sending`. A job can exist for a message the API already marked `failed` (Redis accepted the job after the API's 5-second timeout).
- [x] **Step 4:** the worker needs `ioredis` and `@neuron/db`, as the API does. Queue name, job name and payload type are in `packages/core` (`EMAIL_QUEUE`, `SEND_EMAIL_JOB`, `SendEmailJobData`).
- [x] **Step 5:** `ResendProvider` implements `EmailProvider` in `apps/worker/src/email/`; add `resend` to `EmailProviderName` and the factory in `email.module.ts`.
- [x] **Step 5:** the worker has no HTTP server, but the plan wants a health check Coolify can use. Decide how (e.g. a tiny health endpoint, or a Docker `HEALTHCHECK` command).
- [x] **Step 5:** give the worker container a stop grace period, so it can finish in-flight emails after SIGTERM. It exits with code 143 after a clean stop, which is normal for NestJS.
- [x] **Step 5:** use Node 24 in the Docker images. Prisma 7 warns that Node 26 isn't supported.
- [x] **Deploy:** first deploy to Coolify (2026-11-27). The API applied its migrations and all three containers are healthy, after joining the API and worker to the `coolify` network ([PR #6](https://github.com/RChaubey16/neuron/pull/6)).
- [ ] **Deploy:** after PR #6, redeploy and check the containers stay on the `coolify` network. Then sign in, create an API key, send one email through Resend, and check the worker logs a clean stop (`Worker stopped (SIGTERM)`) on a redeploy.
- [x] **Step 5:** run `prisma migrate deploy` when the API container starts.
- [ ] **Step 7:** today a failed send marks the message `failed` at once and the job isn't retried. Step 7 keeps the message in `sending` between attempts, marks it `failed` only when retries run out or the error is permanent (e.g. SMTP 5xx), and records each attempt in `message_events`.
- [ ] **Step 7:** delivery is at-least-once. If a worker dies after the provider accepted an email but before the status update, BullMQ re-runs the stalled job and the email is sent twice. With Resend this is now handled for 24 hours by the idempotency key; SMTP has no equivalent. `ResendApiError` carries `statusCode` and `code` for telling permanent errors (most 4xx) from retryable ones (429, 5xx, timeouts).
- [ ] **Step 8:** behind Coolify's proxy, set Express's `trust proxy` so `req.ip` is the client's address, not the proxy's, before limiting per IP.
- [ ] **Step 9:** add `templateId` and `variables` to `POST /v1/emails` and the `messages` table.
- [ ] **Step 10:** the dashboard needs a `/sign-in` page that handles `?error=<code>` (`access_denied`, `google_error`, `invalid_state`, `invalid_request`, `email_not_verified`, `not_allowed`, `server_error`).
- [ ] **Step 10:** the web image will need the API's URL at build time (`NEXT_PUBLIC_*` values are baked in by `next build`): add a build `ARG` to `apps/web/Dockerfile` and to `docker-compose.prod.yml`.
- [ ] **Step 10:** session-cookie requests rely on `SameSite=Lax` against cross-site requests. Check whether the dashboard's write requests need CSRF protection beyond that.

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
| 5    | The worker's health check is a small HTTP server on internal port 4001      | Coolify reads Docker health checks; an HTTP check can also report the BullMQ worker's state |
| 5    | Migrations run in the API container's entrypoint, with the Prisma CLI       | No separate migration service; the CLI adds about 370 MB to the API image                   |
| 5    | Resend's idempotency key is the message ID                                  | A re-run job for an email Resend already accepted doesn't send it again (24-hour window)    |
| 5    | Only the configured email provider is created                               | No Resend key is needed for SMTP, and no SMTP pool is opened when using Resend              |
| 5    | Health checks report state; they don't restart containers                   | Coolify's docs only say its proxy stops routing to unhealthy containers; crashes restart    |
| 5    | `api` and `worker` join Coolify's `coolify` network in the compose file     | Coolify gives each app its own network; the compose file is versioned, a UI setting isn't   |

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

- Production: Coolify 4.7.9 on the VPS (`ssh root@201.18.193.101` works from this machine). App UUID `lks9fxtgjifo3bieeugjslmm`; Postgres container `ajs9vapfxdgzjo9h163bavqg`, Redis `3leobonpttkgrvvn6qak8vjn`, both on the `coolify` network.
- DDEV's router uses port 8025, so the local `.env` sets `MAILPIT_UI_PORT=8027`. The Mailpit inbox is at http://localhost:8027.
- In Docker the worker exits with code 0 after a clean stop; run through `pnpm` locally it exits with 143.
- The local `.env` has real Google OAuth credentials and isn't committed. `.env.example` lists every variable.
