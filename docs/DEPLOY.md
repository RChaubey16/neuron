# Deploying Neuron to a VPS

Deploys the backend, the frontend, Redis, and a Caddy reverse proxy to a VPS under two subdomains of a domain whose DNS is managed on Vercel (Vercel is DNS-only here — the app itself doesn't run on Vercel). Replace `yourdomain.com` with your real domain throughout.

Layout: `app.yourdomain.com` → frontend, `api.yourdomain.com` → backend. Caddy terminates TLS (auto Let's Encrypt certs) and reverse-proxies to each service over the internal Docker network; `app`/`frontend` expose no host ports themselves.

## 1. DNS (in Vercel's dashboard)

Add two **A records** pointing at your VPS's public IP:

```
api.yourdomain.com   A   <VPS_IP>
app.yourdomain.com   A   <VPS_IP>
```

No proxying/CDN toggle to worry about — Vercel DNS just resolves. Propagation can take a few minutes; Caddy's cert requests just retry until it resolves.

## 2. VPS baseline setup (fresh box)

SSH in as root once, then:

```bash
# non-root user with sudo
adduser deploy && usermod -aG sudo deploy
# copy your SSH key over so you can log in as deploy, then disable root/password login in /etc/ssh/sshd_config if you like

# firewall — only SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

Log out/in as `deploy` so the docker group membership takes effect.

## 3. Clone the repo onto the VPS

```bash
git clone <your-repo-url> neuron
cd neuron
```

(If the repo's private, set up a deploy key or a PAT for the clone.)

## 4. Google OAuth client

In Google Cloud Console → your OAuth client → Authorized redirect URIs, add:

```
https://api.yourdomain.com/auth/google/callback
```

## 5. Production `.env`

```bash
cp .env.example .env
```

Fill in real values — same set as local dev (`DATABASE_URL`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `RESEND_*`) plus these production-specific ones (documented in `.env.example`):

```bash
FRONTEND_URL="https://app.yourdomain.com"
GOOGLE_CALLBACK_URL="https://api.yourdomain.com/auth/google/callback"
API_DOMAIN="api.yourdomain.com"
APP_DOMAIN="app.yourdomain.com"
NEXT_PUBLIC_API_URL="https://api.yourdomain.com"
REDIS_HOST="redis"
REDIS_PORT=6379
```

`.env` is gitignored — this file lives only on the VPS.

## 6. First deploy

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This builds the backend, builds the frontend (with `NEXT_PUBLIC_API_URL` baked in as a build arg), and starts `app` + `frontend` + `redis` + `caddy`. Caddy is the only service with host ports (80/443) — it fetches Let's Encrypt certs for both subdomains automatically on first request and terminates TLS.

If this Supabase project hasn't had migrations applied yet:

```bash
docker compose -f docker-compose.prod.yml exec app pnpm exec prisma migrate deploy
```

(Skip this if it's the same Supabase project already used in development — migrations are already applied there.)

## 7. Verify

```bash
docker compose -f docker-compose.prod.yml logs -f caddy   # watch for cert issuance
curl -I https://api.yourdomain.com/health                 # expect 200
```

Then in a browser: open `https://app.yourdomain.com`, click through Google sign-in, confirm you land on `/dashboard` with a working session, and create/list an API key to confirm `POST /api-keys` round-trips through the new domain.

Note: the Resend account currently has no verified sending domain, so production email sends will still hit the "can only send to your own address" restriction until a domain is verified in Resend — independent of this deployment.

## 8. Subsequent deploys

```bash
ssh deploy@<VPS_IP>
cd neuron && git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Files involved

- `docker-compose.prod.yml` — production stack (backend, frontend, Redis, Caddy). Dev's `docker-compose.yml` is untouched and unrelated.
- `Caddyfile` — reverse proxy config, parameterized via `{$API_DOMAIN}`/`{$APP_DOMAIN}` read from `.env`, so it never needs hand-editing per deploy.
- `.env.example` — documents the production-only vars (`API_DOMAIN`, `APP_DOMAIN`, `NEXT_PUBLIC_API_URL`) alongside the existing app vars.
