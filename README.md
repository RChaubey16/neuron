# Neuron

A notification system: an email API with a queue-backed worker and a dashboard. SMS comes in phase 2.

The plan, decisions and build order are in [`docs/neuron-phase-1-plan.md`](docs/neuron-phase-1-plan.md).

## Repo layout

| Path            | What it is                                                  |
| --------------- | ----------------------------------------------------------- |
| `apps/api`      | HTTP API (NestJS)                                           |
| `apps/web`      | Dashboard (Next.js)                                         |
| `packages/core` | Types and constants shared by the API, worker and dashboard |
| `apps/worker`   | Queue worker (NestJS), added in step 4 of the build order   |

pnpm workspaces link the packages; Turborepo runs tasks across them in dependency order.

## Local setup

Requirements: Node 24 or newer, pnpm 12, Docker.

```sh
pnpm install
cp .env.example .env   # change ports here if the defaults clash with something
pnpm infra:up          # Postgres, Redis and Mailpit; waits until all are healthy
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

## Scripts

Run from the repo root:

| Script           | Does                                                           |
| ---------------- | -------------------------------------------------------------- |
| `pnpm dev`       | Runs every app in watch mode                                   |
| `pnpm build`     | Builds every package                                           |
| `pnpm lint`      | ESLint                                                         |
| `pnpm typecheck` | TypeScript, no output                                          |
| `pnpm test`      | Vitest                                                         |
| `pnpm format`    | Prettier, writes changes                                       |
| `pnpm check`     | Format check, lint, typecheck and tests: run before committing |
