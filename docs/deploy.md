# Deploying Neuron on Coolify

Neuron runs on a VPS as three containers built from this repo: `api`, `worker` and `web`, described in [`docker-compose.prod.yml`](../docker-compose.prod.yml). Postgres and Redis run as Coolify-managed databases next to them, and Resend sends the email.

```
                     Coolify proxy (HTTPS)
                 ┌────────────┴─────────────┐
       neuron.example.com        api.neuron.example.com
                 │                          │
           web (:3000)                 api (:4000) ────────┐
                                            │ queues a job │ stores the message
                                            ▼              ▼
                                          Redis         Postgres
                                            │              ▲
                                            ▼              │ updates the status
                       Resend ◄──────── worker ────────────┘
```

Replace `neuron.example.com` with your domain everywhere below.

## 1. Resend

1. In Resend, add and verify the domain you'll send from (Domains → Add domain, then add the DNS records it shows).
2. Create an API key with **Sending access** for that domain (API Keys → Create API key). It starts with `re_`.
3. Pick the sender, for example `Neuron <noreply@neuron.example.com>`. It must be on the verified domain.

## 2. Databases in Coolify

Create both in the same project and environment (and on the same server) as the app.

**Postgres:** New resource → Database → PostgreSQL. Turn on scheduled backups. Copy its **internal** URL (`postgres://…`); that's `DATABASE_URL`. The API creates the tables itself when it starts.

**Redis:** New resource → Database → Redis. BullMQ needs Redis to never evict keys (a queued email would be lost), and jobs should survive a restart. In its custom Redis configuration, set:

```
maxmemory-policy noeviction
appendonly yes
```

Copy its **internal** URL (`redis://…`); that's `REDIS_URL`.

Neither database needs a public port.

## 3. The application

1. New resource → your GitHub repository → branch `main`.
2. Build pack: **Docker Compose**. Base directory `/`, compose file `/docker-compose.prod.yml`.
3. Under Advanced, turn on **Connect to Predefined Network**, so the containers can reach the two databases by their internal URLs.
4. Domains, one per service, with the container port:
   - `web`: `https://neuron.example.com:3000`
   - `api`: `https://api.neuron.example.com:4000`
   - `worker`: none.

   Point both DNS names at the VPS. Coolify gets the HTTPS certificates.

## 4. Environment variables

Coolify lists every variable from the compose file and won't deploy until the required ones are set.

| Variable               | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`         | Postgres internal URL from step 2                             |
| `REDIS_URL`            | Redis internal URL from step 2                                |
| `EMAIL_FROM`           | The sender from step 1                                        |
| `RESEND_API_KEY`       | The Resend key from step 1                                    |
| `WEB_URL`              | `https://neuron.example.com`                                  |
| `GOOGLE_CLIENT_ID`     | From the Google OAuth client (same as local, or a new one)    |
| `GOOGLE_CLIENT_SECRET` | From the Google OAuth client                                  |
| `GOOGLE_CALLBACK_URL`  | `https://api.neuron.example.com/auth/google/callback`         |
| `SESSION_SECRET`       | A new secret, not the local one: `openssl rand -base64 48`    |
| `ALLOWED_EMAILS`       | Comma-separated Google accounts allowed to sign in            |
| `COOKIE_DOMAIN`        | `.neuron.example.com`, so the dashboard and API share sign-in |
| `WORKER_CONCURRENCY`   | Optional, default 5                                           |

Mark the secrets (`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `RESEND_API_KEY`, and the two database URLs) as secret in Coolify.

## 5. Google sign-in

In Google Cloud Console → APIs & Services → Credentials → your OAuth client, add `https://api.neuron.example.com/auth/google/callback` under **Authorized redirect URIs**. It has to match `GOOGLE_CALLBACK_URL` exactly. The localhost URI can stay for local development.

## 6. Deploy and check

Deploy. Then:

1. `curl https://api.neuron.example.com/health` should answer `{"status":"ok","checks":{"database":"up","redis":"up"}}`.
2. In the API's logs, `prisma migrate deploy` lists the migrations it applied, then `API listening on port 4000`.
3. In the worker's logs: `Worker started: provider resend, concurrency 5` and `Health check listening on port 4001`.
4. Sign in: open `https://api.neuron.example.com/auth/google` and finish with an allowed account. Google sends you back to the dashboard, and `https://api.neuron.example.com/auth/me` shows your user.
5. Create an API key (see below), then send yourself an email:

   ```sh
   curl -X POST https://api.neuron.example.com/v1/emails \
     -H "Authorization: Bearer nrn_…" \
     -H "Content-Type: application/json" \
     -d '{"to":"you@example.com","subject":"Hello from Neuron","html":"<p>It works.</p>"}'
   ```

   The worker logs `Sent message … (provider ID …)`, the email appears in Resend's log, and it arrives.

Until the dashboard exists (step 10), create the API key from the browser's console on any page of `api.neuron.example.com` while signed in. The request carries your session cookie:

```js
await (
  await fetch('/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'first key' }),
  })
).json();
```

The answer includes the key (`nrn_…`). It's shown only this once.

## How the containers behave

- **Migrations:** the API container runs `prisma migrate deploy` before it starts the server. If a migration fails, the container exits instead of serving with an out-of-date schema; the error is in its logs.
- **Health checks:** each image has a Docker `HEALTHCHECK`. The API checks `GET /health` (Postgres and Redis); the worker checks `GET /health` on port 4001 inside its container (Postgres, Redis and that the BullMQ worker is running); the dashboard checks that it serves its home page. Coolify shows the result, and its proxy stops routing to an unhealthy container. Docker restarts a container that crashes (`restart: unless-stopped`), but not one that is only unhealthy.
- **Stopping the worker:** on a redeploy the worker gets SIGTERM, stops taking jobs, and finishes the ones in progress (each send gives up after 30 seconds). `stop_grace_period: 60s` gives it time before Docker kills it. Jobs still waiting stay in Redis and the new worker sends them. In Docker it exits with code 0 after a clean stop.
- **Duplicate sends:** each email is sent to Resend with its message ID as the idempotency key. If a worker dies after Resend accepted an email but before it recorded `sent`, the job runs again and Resend returns the first email instead of sending a second (for up to 24 hours).
