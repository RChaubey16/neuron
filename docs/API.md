# Neuron API Reference

Endpoint documentation for every route currently implemented, written to be
followed directly in Postman (or any HTTP client). See
[`docs/development-plan.md`](development-plan.md) for what's still to come and
[`CLAUDE.md`](../CLAUDE.md) for architecture/implementation notes.

## Base URL

```
http://localhost:3000
```

(`PORT` in `.env`, default `3000`.) Dashboard/auth routes have no version
prefix. API-key-protected service routes are versioned individually, e.g.
`POST /api/v1/short-url/shorten` — the convention is
`/api/{version}/{service-directory}/{route}`, matching the service's module
directory under `src/`.

**Why the split:** versioning exists to protect an external contract that
evolves independently of its consumers. Dashboard/auth/health routes are
called only by this repo's own first-party frontend, which ships in
lockstep with the backend — there's no separate integration a version bump
could break. Service routes (called by other apps via `x-api-key`) *are*
that external contract, so only those get versioned. `GET /:code` is the
one exception on the service side — it's unauthenticated by design (meant
for a browser to hit directly), so it stays unversioned too. This is
enforced by a standing regression test
(`src/common/api-versioning.spec.ts`).

## Authentication — two separate credential types

Neuron has a **dual auth model**. Don't mix these up — they're different
credentials, checked by different guards, for different kinds of caller.

| | Dashboard routes | Service routes |
|---|---|---|
| Who calls them | A logged-in human, via a dashboard/UI | Another app/service, machine-to-machine |
| Credential | Nest-issued session JWT (self-hosted Google OAuth) | API key |
| Header | `Authorization: Bearer <token>` | `x-api-key: <raw-key>` |
| Guard | `JwtAuthGuard` | `ApiKeyGuard` |
| Routes | `GET /me`, `POST /api-keys`, `GET /api-keys`, `DELETE /api-keys/:id`, `GET /usage` | `POST /api/v1/notifications/email`, `POST /api/v1/short-url/shorten` |

### Getting a session JWT (for dashboard routes, in Postman)

There's no dashboard frontend yet. This app drives the Google OAuth redirect
itself, so to get a real token for Postman:

1. Open `GET /auth/google` (i.e. `http://localhost:3000/auth/google`) directly
   in a browser. It redirects to Google's consent screen.
2. Complete the Google login. Google redirects back to this app's
   `GET /auth/google/callback`, which looks up/creates the local `User` row
   and issues a session JWT.
3. That callback redirects the browser to
   `${FRONTEND_URL}/auth/callback#token=<jwt>` — copy the `token` value out
   of the URL fragment (there's no frontend listening there yet, so the
   browser will just show a "can't be reached"-style page; the token is
   still in the address bar).
4. In Postman, set the `Authorization` header on the request (or a
   collection/environment variable, see [Postman setup](#postman-setup)
   below) to `Bearer <token>`.

Tokens expire per `JWT_EXPIRES_IN` (`.env`) — if you start getting `401
Unauthorized` after a while, repeat the flow for a fresh token.

### Getting an API key (for service routes, in Postman)

API keys are created through the dashboard routes, so you need a JWT first:

1. `POST /api-keys` with a valid `Authorization: Bearer <token>` header (see
   below). The response's `key` field is the **raw key — shown exactly
   once**. Copy it immediately; it is never stored or returned again.
2. Use that raw key as the `x-api-key` header value on service routes.

Alternatively, for local development against a Supabase DB you own,
`pnpm exec prisma db seed` creates a test user and prints a ready-to-use raw
API key without needing to go through Google OAuth at all.

Note the seeded user has no real Google login — there's no session JWT for
it. Seeding only gets you the API key for service routes; dashboard routes
still need a real `GET /auth/google` login.

## Rate limiting

All routes are rate-limited via a global default (**20 requests / 60s**),
except:

- `GET /health` — exempt, so uptime monitors/liveness probes are never
  throttled.
- `POST /api/v1/notifications/email` — tighter: **10 requests / 60s**.
- `POST /api/v1/short-url/shorten` — tighter: **10 requests / 60s**.
- `GET /:code` — looser: **60 requests / 60s**.

A request over the limit gets `429 Too Many Requests`. Limits are tracked
**per API key** (`ApiKeyThrottlerGuard` hashes the incoming `x-api-key`
header and keys the counter on that), not per IP — so one caller can't burn
through another caller's quota just by sharing a NAT/proxy, and a single
caller can't dodge the limit by rotating IPs. Requests with no `x-api-key`
(dashboard/auth/health routes, and the unauthenticated `GET /:code`
redirect) fall back to per-IP tracking instead.

## Response conventions

- All response bodies are JSON, shaped by an explicit response DTO — fields
  not listed below are never present (e.g. a hashed API key is never
  returned, even internally).
- Request bodies are validated with `whitelist: true, forbidNonWhitelisted:
  true`: any field not declared on the DTO is rejected with `400 Bad
  Request`, not silently dropped. Route path params are validated the same
  way (e.g. `DELETE /api-keys/:id`'s `id`, `GET /:code`'s `code`) — a
  malformed param is rejected with `400` before it ever reaches the
  database, rather than falling through to a `404`.
- Error responses (any 4xx/5xx) go through a global exception filter and
  always follow this shape, whether it's a routine `HttpException` or an
  unexpected server-side fault:
  ```json
  {
    "statusCode": 401,
    "message": "Missing bearer token",
    "error": "Unauthorized",
    "timestamp": "2026-09-02T05:17:19.292Z",
    "path": "/me",
    "requestId": "d25fa7e1-5162-4bba-9cc3-15a68145380f"
  }
  ```
  `message` can be a string or (for validation errors) an array of strings,
  one per invalid field. `requestId` matches the `x-request-id` response
  header (and the caller's own `x-request-id` request header, if one was
  sent — otherwise a generated UUID) — useful for correlating a specific
  failed request with server-side logs. A 5xx never includes the original
  internal error message (e.g. a raw exception or database error) in the
  response body — only `"Internal server error"` — the real detail is
  logged server-side instead.

---

## Endpoints

### `GET /health`

Liveness check. No auth required, no rate limit.

**Response — `200 OK`**
```json
{ "status": "ok" }
```

---

### `GET /me`

Returns the logged-in user's profile, lazily creating the local `User` row
on that user's very first authenticated request.

**Auth:** `Authorization: Bearer <jwt>`

**Response — `200 OK`**
```json
{
  "id": "104852374619283746192",
  "email": "user@example.com",
  "createdAt": "2026-08-29T10:00:00.000Z"
}
```
(`id` is Google's `sub` claim, not a Prisma-generated UUID — it's whatever
numeric string Google assigns that account.)

**Errors**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing `Authorization` header, or the token is invalid/expired |

---

### `POST /api-keys`

Generates a new API key for the logged-in user. **The raw key is returned
only in this response — copy it now.** Only its SHA-256 hash and a display
prefix are ever persisted.

**Auth:** `Authorization: Bearer <jwt>`

**Request body**
| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | No | Max 100 chars. A display label for the key. |

```json
{ "name": "CI key" }
```
(`{}` is also valid — `name` is optional.)

**Response — `201 Created`**
```json
{
  "id": "9c1e...-uuid",
  "keyPrefix": "nrn_ab12cd34",
  "name": "CI key",
  "createdAt": "2026-08-30T12:00:00.000Z",
  "lastUsedAt": null,
  "revokedAt": null,
  "key": "nrn_ab12cd34ef56...-the-full-raw-key"
}
```

**Errors**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing/invalid bearer token |
| `400 Bad Request` | `name` present but not a string, or over 100 chars, or an unexpected field is included |

---

### `GET /api-keys`

Lists the logged-in user's API keys, most recently created first. Never
includes the raw key or its hash — only `keyPrefix` for display.

**Auth:** `Authorization: Bearer <jwt>`

**Response — `200 OK`**
```json
[
  {
    "id": "9c1e...-uuid",
    "keyPrefix": "nrn_ab12cd34",
    "name": "CI key",
    "createdAt": "2026-08-30T12:00:00.000Z",
    "lastUsedAt": "2026-08-30T12:05:00.000Z",
    "revokedAt": null
  }
]
```

**Errors**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing/invalid bearer token |

---

### `DELETE /api-keys/:id`

Revokes (soft-deletes) one of the caller's own API keys. A revoked key can
no longer authenticate service requests.

**Auth:** `Authorization: Bearer <jwt>`

**Path params**
| Param | Type | Notes |
|---|---|---|
| `id` | string (uuid v4) | The `id` field from `POST`/`GET /api-keys` — not the raw key itself. Must be a well-formed UUID or the request is rejected before the database is queried. |

**Response — `204 No Content`** (empty body)

**Errors**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing/invalid bearer token |
| `400 Bad Request` | `id` isn't a valid UUID |
| `404 Not Found` | The key doesn't exist, isn't owned by the caller, or is already revoked |

---

### `GET /usage`

Aggregate call counts for the logged-in user's own API keys, grouped by
service, day, and key.

**Auth:** `Authorization: Bearer <jwt>`

**Response — `200 OK`**
```json
[
  {
    "service": "url-shortener",
    "date": "2026-08-30",
    "apiKeyId": "9c1e...-uuid",
    "count": 4
  }
]
```
Rows are ordered most-recent day first. An empty array means the caller's
keys have no recorded usage yet.

**Errors**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing/invalid bearer token |

---

### `POST /api/v1/notifications/email`

Queues an email for delivery via Resend. **Fire-and-forget by design** —
this returns as soon as the job is queued (BullMQ + Redis), not once the
email actually sends. There's no status/lookup endpoint; check server logs
if you need delivery confirmation. Every call is logged to `UsageLog` under
the `email-notifications` service.

**Auth:** `x-api-key: <raw-api-key>`

**Rate limit:** 10 requests / 60s (tighter than the global default)

**Request body**
| Field | Type | Required | Notes |
|---|---|---|---|
| `to` | string[] (email) | Yes | 1–50 recipients, each a valid email address |
| `subject` | string | Yes | Non-empty, max 200 chars |
| `body` | string | Yes | Non-empty, max 100,000 chars. HTML is sent as-is (Resend renders it) |

```json
{
  "to": ["recipient@example.com"],
  "subject": "Your report is ready",
  "body": "<p>Hello — your report is attached.</p>"
}
```

**Response — `202 Accepted`**
```json
{ "queued": true }
```

**Errors**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing `x-api-key` header, or the key is invalid/revoked |
| `400 Bad Request` | `to` is empty/not emails/over 50 recipients, or `subject`/`body` is empty or over its max length |
| `429 Too Many Requests` | Rate limit exceeded |

A queued job retries up to 3 times (exponential backoff) if Resend rejects
it or the send otherwise fails — this all happens after the `202` response,
so it's invisible to the caller. Note: the Resend account backing this API
may have no verified sending domain in dev/staging, in which case every send
fails with a `validation_error`/403 logged server-side regardless of the
request being well-formed — that's a Resend account configuration issue,
not a bug in this endpoint.

---

### `POST /api/v1/short-url/shorten`

Creates a shortened URL owned by the calling API key. The first real
service route — every call here is also logged to `UsageLog` under the
`url-shortener` service.

**Auth:** `x-api-key: <raw-api-key>`

**Rate limit:** 10 requests / 60s (tighter than the global default)

**Request body**
| Field | Type | Required | Notes |
|---|---|---|---|
| `originalUrl` | string (URL) | Yes | Must include an `http://` or `https://` scheme — other schemes (e.g. `javascript:`) are rejected |

```json
{ "originalUrl": "https://example.com/some/very/long/path" }
```

**Response — `201 Created`**
```json
{
  "code": "UgFiSdm",
  "originalUrl": "https://example.com/some/very/long/path",
  "createdAt": "2026-08-30T12:00:00.000Z",
  "clickCount": 0
}
```
No absolute short link is returned — there's no public base URL configured
until deployment (Phase 8). Build the link yourself as
`{base URL}/{code}` (e.g. `http://localhost:3000/UgFiSdm`).

**Errors**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing `x-api-key` header, or the key is invalid/revoked |
| `400 Bad Request` | `originalUrl` missing, not a URL, or missing an `http(s)` scheme |
| `409 Conflict` | Could not generate a unique short code after several attempts (extremely rare) |
| `429 Too Many Requests` | Rate limit exceeded |

---

### `GET /:code`

Redirects to the original URL for a short code. **Unauthenticated by
design** — meant to be hit directly by browsers, not called with an API key.
Increments `clickCount` on every successful redirect (async, doesn't delay
the response).

> This is a catch-all single-segment route. Since it's the last route
> registered app-wide, it never shadows other endpoints like `/health` or
> `/usage` — but it does mean any single-segment path that isn't one of the
> other documented routes will attempt to resolve as a short code and 404 if
> it doesn't exist.

**Auth:** None

**Rate limit:** 60 requests / 60s (looser than the global default, since
real end users click these links)

**Path params**
| Param | Type | Notes |
|---|---|---|
| `code` | string | The `code` field from `POST /api/v1/short-url/shorten`'s response. Must be exactly 7 characters from `[A-Za-z0-9_-]` (nanoid's alphabet) or the request is rejected before the database is queried. |

**Response — `302 Found`**, with a `Location` header set to the original
URL. Postman (like a browser) will follow this automatically unless you
disable redirect-following in its settings to inspect the header directly.

**Errors**
| Status | When |
|---|---|
| `400 Bad Request` | `code` isn't 7 characters from the expected alphabet (e.g. wrong length, or contains a character nanoid never generates) |
| `404 Not Found` | `code` is well-formed but no `ShortUrl` exists for it |
| `429 Too Many Requests` | Rate limit exceeded |

---

## Postman setup

Recommended environment variables for a Postman collection:

| Variable | Example value | Set from |
|---|---|---|
| `baseUrl` | `http://localhost:3000` | Fixed |
| `jwt` | `eyJhbGciOi...` | `token` fragment from `GET /auth/google`'s callback redirect |
| `apiKey` | `nrn_ab12cd34...` | `POST /api-keys`'s `key` field, or the seed script |
| `shortCode` | `UgFiSdm` | `POST /api/v1/short-url/shorten`'s `code` field |

Then:
- Dashboard requests: `{{baseUrl}}/me`, header `Authorization: Bearer {{jwt}}`
- Service requests: `{{baseUrl}}/api/v1/short-url/shorten`, header `x-api-key: {{apiKey}}`
- Redirect check: `{{baseUrl}}/{{shortCode}}`

**Suggested end-to-end flow to exercise the whole API in one pass:**
1. `GET /health` — sanity check the server is up.
2. Get a JWT via `GET /auth/google` (complete the Google login, copy the
   `token` fragment from the callback redirect), set `{{jwt}}`.
3. `GET /me` — confirms the JWT works and lazily creates your `User` row.
4. `POST /api-keys` — copy the `key` field into `{{apiKey}}`.
5. `GET /api-keys` — confirm it's listed (without the raw key).
6. `POST /api/v1/short-url/shorten` with `{{apiKey}}` — copy the `code` field into
   `{{shortCode}}`.
7. `GET /{{shortCode}}` — confirm the redirect.
8. `POST /api/v1/notifications/email` with `{{apiKey}}` — confirm `202
   { "queued": true }`.
9. `GET /usage` with `{{jwt}}` — confirm `url-shortener` and
   `email-notifications` rows now each show a count of at least 1.
10. `DELETE /api-keys/:id` — revoke the key, then repeat step 6 (or step 8)
    and confirm it now returns `401`.
