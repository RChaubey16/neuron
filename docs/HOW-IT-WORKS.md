# How Neuron's tech works

A plain-language tour of the technology behind Neuron: what each piece is,
why it's there, and what actually happens when someone uses it. No prior
backend knowledge assumed.

For *what* Neuron does, see [`OVERVIEW.md`](OVERVIEW.md). For exact
endpoints, see [`API.md`](API.md). For implementation detail and gotchas,
see [`CLAUDE.md`](../CLAUDE.md).

## The short version

Neuron is a restaurant kitchen that several restaurants share.

- **The API** (NestJS) is the kitchen. Orders come in, get checked, and get
  cooked.
- **The database** (Postgres) is the order book. Everything that must not be
  forgotten is written down there.
- **The queue** (Redis + BullMQ) is the ticket rail. Slow jobs, like sending
  an email, get pinned up and handled by a cook in the back, so the waiter
  doesn't stand around waiting.
- **The dashboard** (Next.js) is the front desk, where the owner signs in,
  hands out keys to their other apps, and checks how busy things have been.
- **Resend** is the delivery service Neuron hands emails to.

## The pieces, one by one

### The API: NestJS

The backend is written in TypeScript using **NestJS**, a framework for
building web servers. It listens for HTTP requests (the same kind of request
your browser makes when it loads a page) and answers them with JSON.

Nest organises code into **modules**, one per feature: `auth`, `api-keys`,
`usage`, `notifications`, `short-url`, `health`. Each module has:

- a **controller**, which says which URLs it answers (e.g.
  `POST /api/v1/short-url/shorten`), and
- a **service**, which holds the actual logic (e.g. "make a short code and
  save it").

Before a request reaches a controller, it passes a few checkpoints:

1. **Request ID.** Every request gets a unique id, attached to every log
   line it produces, so one request can be traced through the logs.
2. **Rate limiting.** Each caller gets a budget, 20 requests a minute by
   default. Go over it and you get `429 Too Many Requests` until the minute
   resets.
3. **Guard (the bouncer).** Checks the caller's credentials. See "Who's
   allowed in" below.
4. **Validation.** Checks the request body has the right shape, e.g. `to`
   is a list of real email addresses. Anything unexpected is rejected with
   `400 Bad Request` before any logic runs.

If anything goes wrong deep inside, a single **exception filter** turns it
into one consistent JSON error. Internal details, such as a database error
message, are never sent back to the caller, only written to the logs.

### The database: Postgres on Supabase

All permanent data lives in a **Postgres** database, hosted by **Supabase**.
Neuron uses Supabase only as a database host; login is handled separately.

The main tables:

| Table | What a row means |
|---|---|
| `User` | A person who has signed in with Google |
| `ApiKey` | A key one of those users created for their other apps |
| `ShortUrl` | A short code and the long URL it points to |
| `EmailJob` | One email someone asked Neuron to send, and how it's going |
| `UsageLog` | One record of "this user called this service at this time" |

Every `ShortUrl`, `EmailJob`, and `UsageLog` row belongs to a user. It also
notes which API key was used, if one was.

The code talks to the database through **Prisma**, which turns TypeScript
calls like `prisma.shortUrl.create(...)` into SQL.

### The queue: Redis and BullMQ

Sending an email means calling an outside service over the internet, which
can be slow or fail. Neuron doesn't make the caller wait for that.

Instead:

1. The API writes the email to the `EmailJob` table with status `QUEUED`.
2. It drops a small "please send job X" ticket into a **queue**.
3. It immediately replies `202 Accepted` ("got it, working on it").
4. A **worker** running in the background picks the ticket up and sends the
   email.

The queue lives in **Redis**, a fast in-memory data store, and **BullMQ** is
the library that manages it. BullMQ handles retries: if a send fails, it
tries again, up to 3 times, waiting longer each time.

The database stays the source of truth for an email's status. The queue
only drives the work. That's why you can always look up a job, even after
the queue has cleaned up its own old tickets.

If Redis is down, the API doesn't wait for it to come back. It marks the
email `FAILED` straight away and returns `503 Service Unavailable`. You can
retry it from the dashboard later.

### Sending the email: Resend

The worker hands each email to **Resend**, a service that delivers email.
Neuron never runs a mail server itself.

### The dashboard: Next.js on Vercel

The dashboard is a separate web app built with **Next.js** and **React**,
hosted on **Vercel**. It doesn't have its own database. Everything it shows
comes from calling the Neuron API, exactly like any other app would.

## Who's allowed in: two kinds of credentials

Neuron has two kinds of callers, and each has its own credential.

### Humans: Google sign-in and a session token

1. You click "Sign in with Google" on the dashboard.
2. Google asks you to confirm, then sends you back to Neuron with proof of
   who you are.
3. Neuron creates your `User` row the first time it sees you.
4. Neuron gives the dashboard a **session token** (a JWT, or JSON Web
   Token): a signed note that says "this is user X", valid for 7 days by
   default.
5. The dashboard stores it in the browser and attaches it to every request
   (`Authorization: Bearer <token>`).

Only Neuron knows the secret used to sign the token, so a forged or tampered
one fails the check. Once the signature checks out, Neuron loads your `User`
row, and rejects the token if that user no longer exists. If a request comes back `401 Unauthorized`, the dashboard throws the
token away and sends you to the sign-in page.

### Apps: API keys

Your other apps can't click "Sign in with Google", so they use an **API
key** instead.

1. You create a key on the dashboard. Neuron shows it to you **once**.
2. Neuron stores only a **hash** of it: a one-way fingerprint that can check
   a key but can't be turned back into it. Even someone reading the database
   can't recover your key.
3. Your app sends the key in an `x-api-key` header on every request.
4. Neuron hashes what it receives and looks for a matching, un-revoked key.

You can **revoke** a key (it stops working but stays listed) or **delete**
it (it stops working and disappears from the list). Records made with a
deleted key keep their history.

### Which routes use which

- Routes starting `/api/v1/...` are for **apps** and need an API key.
  They're versioned, so they can change later without breaking apps already
  using them.
- Other routes, like `/api-keys` and `/usage`, are for the **dashboard** and
  need a session token.
- A few routes need neither: the health checks, the Google sign-in steps,
  and the short-link redirect (`GET /:code`), which anyone should be able to
  click.

Every service works from both sides. Shortening a link from the dashboard
and from an app runs the exact same code. Only the checkpoint in front of it
differs.

## Following a request end to end

### An app shortens a link

1. Your app sends `POST /api/v1/short-url/shorten` with its API key and
   `{ "url": "https://example.com/very/long/page" }`.
2. The request gets an id, passes the rate limit, and the guard confirms the
   key.
3. Validation checks the body is a real URL.
4. The service makes a random 7-character code (e.g. `aB3xK9q`) and saves a
   `ShortUrl` row. On the rare chance that code is taken, it picks another.
5. The API replies with the short link.
6. After the reply, a `UsageLog` row is written in the background. It
   doesn't slow the response down.

Later, someone clicks `https://neuron-api.ruturaj.xyz/aB3xK9q`. Neuron looks
up the code, adds one to its click count in the background, and redirects
the browser to the long URL.

### Someone sends an email from the dashboard

1. The dashboard sends `POST /notifications/email` with your session token.
2. The guard confirms the token, and validation checks the recipients,
   subject, and body.
3. The service saves an `EmailJob` row (`QUEUED`), puts a ticket on the
   queue, and replies `202 Accepted`.
4. The worker picks up the ticket and marks the job `PROCESSING`.
5. It hands the email to Resend.
   - Success: the job becomes `SENT`.
   - Failure: BullMQ retries it. After the third failure, the job becomes
     `FAILED` and the error is saved on the row.
6. The dashboard's notifications page shows the current status, and lets
   you retry a `FAILED` job or cancel one that's still `QUEUED`.

## Keeping track: usage logs

Every service call, from an app or the dashboard, writes a `UsageLog` row:
who, which service, which endpoint, when. The dashboard's Usage page adds
these up per day and per service, so you can see whether an app is actually
using Neuron.

## Where it all runs

| Piece | Where |
|---|---|
| API and background worker | A Hostinger VPS, deployed with Coolify, at `neuron-api.ruturaj.xyz` |
| Redis | A container next to the API on the same VPS |
| Database | Supabase (managed Postgres) |
| Dashboard | Vercel, at `neuron.ruturaj.xyz` |
| Email delivery | Resend |

The API is packaged with **Docker**: one `Dockerfile` builds an image
containing the app and everything it needs. The same image runs on a laptop
(`docker compose up`) and in production, so "works on my machine" and
"works in production" mean the same thing.

**Coolify** is the deployment tool on the VPS. It pulls the code from git,
builds the Docker image, starts the API and Redis containers, and puts them
behind HTTPS.

**GitHub Actions** runs on every push to `main`: it lints and builds the
code and runs the tests for both the API and the dashboard.

## Is it healthy?

Two URLs answer that:

- `GET /health` answers "is the API running at all?". It returns
  `{ "status": "ok" }` as long as the process is up.
- `GET /health/ready` answers "can it actually do its job?". It checks that
  the database and Redis both respond, and returns `503` with which one
  failed if not. This is the one to point an uptime monitor at.

## Glossary

| Term | Meaning |
|---|---|
| **API** | A set of URLs a program can call to get data or get something done |
| **Endpoint / route** | One of those URLs plus its method, e.g. `POST /api/v1/short-url/shorten` |
| **JSON** | The text format requests and responses are written in |
| **JWT** | A signed token that proves who you are; the signature shows the server issued it and nobody changed it |
| **Hash** | A one-way fingerprint of some data; you can check against it but not reverse it |
| **Queue** | A list of jobs waiting to be done in the background |
| **Worker** | The background process that takes jobs off the queue and does them |
| **Guard** | Nest's name for the check that decides whether a request is allowed in |
| **Container** | A packaged, isolated copy of an app and everything it needs to run |
| **Status codes** | `200` OK, `202` accepted for later, `400` bad request, `401` not signed in, `404` not found, `429` too many requests, `503` a dependency is down |
