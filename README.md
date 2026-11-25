# Neuron

A notification system: an email API with a queue-backed worker and a dashboard. SMS comes in phase 2.

The plan, decisions and build order are in [`docs/neuron-phase-1-plan.md`](docs/neuron-phase-1-plan.md).

## Repo layout

| Path            | What it is                                                         |
| --------------- | ------------------------------------------------------------------ |
| `apps/api`      | HTTP API (NestJS)                                                  |
| `apps/web`      | Dashboard (Next.js)                                                |
| `packages/core` | Types and constants shared by the API, worker and dashboard        |
| `packages/db`   | Prisma schema, migrations and client, shared by the API and worker |
| `apps/worker`   | Queue worker (NestJS), added in step 4 of the build order          |

pnpm workspaces link the packages; Turborepo runs tasks across them in dependency order.

## Local setup

Requirements: Node 24 or newer, pnpm 12, Docker.

```sh
pnpm install
cp .env.example .env   # then fill in the Google and session values (see below)
pnpm infra:up          # Postgres, Redis and Mailpit; waits until all are healthy
pnpm --filter @neuron/db db:deploy   # apply database migrations
pnpm dev               # API on :4000, dashboard on :3000
```

| Service   | Default address                                       |
| --------- | ----------------------------------------------------- |
| API       | http://localhost:4000 (health: `GET /health`)         |
| Dashboard | http://localhost:3000                                 |
| Postgres  | `localhost:5432`, user/password/db `neuron`           |
| Redis     | `localhost:6379`                                      |
| Mailpit   | SMTP `localhost:1025`, inbox at http://localhost:8025 |

Stop the infrastructure with `pnpm infra:down` (data is kept in Docker volumes).

### Google sign-in

The dashboard signs in with Google, and the API won't start until these are set in `.env`:

1. In Google Cloud Console, go to **APIs & Services > Credentials > Create credentials > OAuth client ID**, type **Web application**.
2. Add `http://localhost:4000/auth/google/callback` as an **Authorized redirect URI**.
3. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Set `SESSION_SECRET` (`openssl rand -base64 48`) and `ALLOWED_EMAILS` (your Google email).

Then open http://localhost:4000/auth/google to sign in.

### Database changes

Edit `packages/db/prisma/schema.prisma`, then create and apply a migration:

```sh
pnpm --filter @neuron/db db:migrate --name describe_the_change
```

## Sending an email

Create an API key in the dashboard (or `POST /api-keys` while signed in), then:

```sh
curl -X POST http://localhost:4000/v1/emails \
  -H "Authorization: Bearer nrn_..." \
  -H "Content-Type: application/json" \
  -d '{"to": "someone@example.com", "subject": "Hello", "html": "<p>Hello!</p>", "text": "Hello!"}'
```

The response is `202 Accepted` with `{"id": "...", "status": "queued"}`: the email is stored and queued, and the worker sends it.

| Field     | Rules                                      |
| --------- | ------------------------------------------ |
| `to`      | One email address                          |
| `subject` | 1–998 characters, no line breaks           |
| `html`    | Required, up to 512 KiB                    |
| `text`    | Optional plain-text version, up to 256 KiB |

The sender is always `EMAIL_FROM`. Unknown fields (including `from`) are rejected with `400`. If the queue is unavailable the API answers `503` and the email is not sent; retrying is safe.

## Scripts

Run from the repo root:

| Script           | Does                                                                           |
| ---------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`       | Runs every app in watch mode                                                   |
| `pnpm build`     | Builds every package                                                           |
| `pnpm lint`      | ESLint                                                                         |
| `pnpm typecheck` | TypeScript, no output                                                          |
| `pnpm test`      | Vitest. The API tests need `pnpm infra:up` (they use a `neuron_test` database) |
| `pnpm format`    | Prettier, writes changes                                                       |
| `pnpm check`     | Format check, lint, typecheck and tests: run before committing                 |
