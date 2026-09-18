# Neuron, in plain English

A one-page mental model of what Neuron actually is today. If you just want
"what changed and why," start here. For deep implementation detail, gotchas,
and full history, see [`CLAUDE.md`](../CLAUDE.md); for exact request/response
shapes, see [`API.md`](API.md); for the phase-by-phase build checklist, see
[`development-plan.md`](development-plan.md).

## What is Neuron?

Neuron is one shared backend that other apps and a human dashboard both call
into. Instead of every side project reinventing "send an email," "shorten a
link," "log in a user," and "track who called what," those things live here
once, and everything else plugs into them.

Two kinds of caller use it:

- **A human**, through a web dashboard — logs in with Google, manages API
  keys, and can also use the services directly (send an email, shorten a
  link) right from the dashboard UI.
- **A machine** — some other app, calling Neuron's HTTP API with an API key
  instead of a login.

Both paths end up doing the same things, through the same code — a human
clicking "shorten a URL" in the dashboard and another app calling
`POST /api/v1/short-url/shorten` both go through the exact same
`ShortUrlService`.

## The big picture

```
                 ┌─────────────────────┐
   Human   ────► │   Dashboard (web)   │
  (browser)      │  Google login → JWT │
                 └──────────┬──────────┘
                            │
                            ▼
   Machine  ─────►  ┌───────────────┐        ┌──────────────────┐
 (another app,      │  Neuron API   │ ─────► │  Services         │
  x-api-key)        │  (NestJS)     │        │  • Notifications  │
                 ┌─► │               │        │  • URL Shortener  │
                 │   └───────┬───────┘        └────────┬──────────┘
                 │           │                          │
                 │           ▼                          ▼
                 │   ┌───────────────┐        ┌──────────────────┐
                 │   │  Usage log     │        │  Postgres (via   │
                 └── │  (who called   │        │  Supabase)       │
                     │  what, when)   │        └──────────────────┘
                     └───────────────┘
```

Every request — dashboard or API key — ends up owned by a real person (a
`User` row), goes through the same service code, and gets logged the same
way. There's no separate "dashboard version" of a service; the dashboard is
just another caller.

## The two credentials, and why they're different

| | A human, via the dashboard | Another app, via the API |
|---|---|---|
| How they prove who they are | Logs in with Google | Sends an `x-api-key` header |
| What they get | A session token, good until it expires | An API key, good until revoked |
| Where they get it | Google OAuth login flow | Created from inside the dashboard, once logged in |
| What it's for | Managing your account, browsing usage, using services by hand | Letting *your other apps* call Neuron programmatically |

You can have several API keys (e.g. one per app you're integrating), and
revoke any one of them without affecting the others or your dashboard login.
API keys are stored as a one-way hash — even Neuron itself can't produce the
raw key again after the moment it's created, which is why the dashboard
shows it to you exactly once.

## What Neuron can actually do today

**Notifications (send an email).** Any caller — dashboard or API key — can
queue an email to be sent through Resend. It doesn't send synchronously:
it's placed on a queue and a background worker sends it, retrying
automatically (up to 3 times) if the send fails. You can check a job's
status, retry a failed one by hand, cancel a queued one before it goes out,
or send from a small set of pre-built templates (e.g. "welcome email") by
filling in a few variables instead of writing the subject/body yourself.

**URL Shortener.** Any caller can turn a long URL into a short code; visiting
`{base URL}/{code}` in a browser redirects to the original URL and counts
the click. The redirect itself needs no login or API key — it's meant to be
clicked by anyone.

Both of these are built the same way (same guard pattern, same usage
logging, same "usable from the dashboard or the API" duality) specifically
so the *next* service — file storage, SMS, webhooks, whatever comes after —
can be built by copying the pattern rather than inventing a new one.

## What the dashboard actually shows you

After logging in with Google, a human sees:

- **API Keys** — create, name, and revoke keys for your other apps to use.
- **Usage** — a per-day, per-service count of what's been called, so you can
  see at a glance whether an integration is actually calling Neuron.
- **URLs** / **Notifications** — the services themselves, usable by hand
  from a form, not just described in docs for you to curl.
- **Routes** — a plain reference page listing every API endpoint with
  example calls, for when you *do* want to wire up an app to Neuron rather
  than click through the UI.

## The idea behind a recent, big change: "who owns this?"

For a while, when you used a service *from the dashboard* rather than
through a real API key, Neuron quietly created a hidden, invisible API key
behind the scenes just so every row in the database could point at "the key
that made this call." It worked, but it was backwards — the dashboard had
to pretend to be a machine caller just to fit the data model.

That's been replaced: every email job, short URL, and usage log now records
*which user it belongs to*, directly — whether it was created from the
dashboard or from a real API key. The API key is now optional extra
information ("which specific integration made this call"), not the thing
ownership is built on. Practically, this means: retrying or cancelling a
notification works no matter which of your keys originally queued it, the
hidden fake API key is gone entirely, and a future feature that needs "give
me everything this user has ever done" doesn't need to reverse-engineer it
through a chain of keys.

## Where it actually runs

- **Backend** — a Hostinger VPS, deployed via Coolify, at
  `https://neuron-api.ruturaj.xyz`.
- **Dashboard** — Vercel, at `https://neuron.ruturaj.xyz`.
- **Database** — Supabase Postgres (database only — it doesn't handle login;
  Google OAuth does).
- **Queue** — Redis, for the notifications background worker.

A real browser has walked through Google login → dashboard → logout against
this exact production setup, and CORS/TLS/routing have all been confirmed
working end-to-end.

## What's honestly not done yet

- **No other real app has been pointed at the live API yet.** Everything so
  far has been verified by hand (curl, Postman, a manually-minted test
  token) — the "a separate live app successfully calls this in production"
  milestone hasn't happened.
- **No uptime monitoring or alerting.** If the backend goes down, nothing
  currently notices except a person checking.
- **One dev/prod environment, not separate ones.** There's a single Supabase
  project and a single Redis instance — no staging tier yet.
- **A Redis outage doesn't fail loudly.** If Redis is unreachable, queuing a
  notification hangs instead of returning a clean error — a known gap, not
  yet fixed.

None of these block using what's built; they're the honest list of what
"production-ready" still doesn't fully mean here yet.

## Where to look next

- **Want to call the API right now?** → [`API.md`](API.md) — every endpoint,
  with example requests/responses and a Postman walkthrough.
- **Want the full history of *why* things are built this way, plus every
  sharp edge and gotcha?** → [`CLAUDE.md`](../CLAUDE.md).
- **Want to know what's built vs. still planned?** →
  [`development-plan.md`](development-plan.md).
