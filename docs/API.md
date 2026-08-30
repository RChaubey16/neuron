# Neuron API Reference

Endpoint documentation for every route currently implemented, written to be
followed directly in Postman (or any HTTP client). See
[`docs/development-plan.md`](development-plan.md) for what's still to come and
[`CLAUDE.md`](../CLAUDE.md) for architecture/implementation notes.

## Base URL

```
http://localhost:3000
```

(`PORT` in `.env`, default `3000`.) There is no `/v1` prefix yet — API
versioning is a planned Phase 7 item.

## Authentication — two separate credential types

Neuron has a **dual auth model**. Don't mix these up — they're different
credentials, checked by different guards, for different kinds of caller.

| | Dashboard routes | Service routes |
|---|---|---|
| Who calls them | A logged-in human, via a dashboard/UI | Another app/service, machine-to-machine |
| Credential | Supabase-issued JWT | API key |
| Header | `Authorization: Bearer <token>` | `x-api-key: <raw-key>` |
| Guard | `SupabaseJwtGuard` | `ApiKeyGuard` |
| Routes | `GET /me`, `POST /api-keys`, `GET /api-keys`, `DELETE /api-keys/:id`, `GET /usage` | `POST /shorten` |

### Getting a Supabase JWT (for dashboard routes, in Postman)

There's no dashboard frontend yet. To get a real token for Postman:

1. Open `scripts/manual-google-login.html` in a browser (a throwaway static
   page, already pointed at this project's Supabase URL/anon key).
2. Complete the Google OAuth login. The page prints the resulting
   `access_token`.
3. In Postman, set the `Authorization` header on the request (or a
   collection/environment variable, see [Postman setup](#postman-setup)
   below) to `Bearer <access_token>`.

Tokens are short-lived — if you start getting `401 Unauthorized` after a
while, re-run the login flow for a fresh token.

### Getting an API key (for service routes, in Postman)

API keys are created through the dashboard routes, so you need a JWT first:

1. `POST /api-keys` with a valid `Authorization: Bearer <token>` header (see
   below). The response's `key` field is the **raw key — shown exactly
   once**. Copy it immediately; it is never stored or returned again.
2. Use that raw key as the `x-api-key` header value on service routes.

Alternatively, for local development against a Supabase DB you own,
`pnpm exec prisma db seed` creates a test user and prints a ready-to-use raw
API key without needing to go through Google OAuth at all.

## Rate limiting

All routes are rate-limited via a global default (**20 requests / 60s**,
per IP), except:

- `GET /health` — exempt, so uptime monitors/liveness probes are never
  throttled.
- `POST /shorten` — tighter: **10 requests / 60s**.
- `GET /:code` — looser: **60 requests / 60s**.

A request over the limit gets `429 Too Many Requests`. This is IP-based, not
per-API-key, for now (per-API-key rate limiting is a planned Phase 7 item).

## Response conventions

- All response bodies are JSON, shaped by an explicit response DTO — fields
  not listed below are never present (e.g. a hashed API key is never
  returned, even internally).
- Request bodies are validated with `whitelist: true, forbidNonWhitelisted:
  true`: any field not declared on the DTO is rejected with `400 Bad
  Request`, not silently dropped.
- Error responses (any 4xx/5xx) follow Nest's default shape:
  ```json
  {
    "statusCode": 401,
    "message": "Missing bearer token",
    "error": "Unauthorized"
  }
  ```
  `message` can be a string or (for validation errors) an array of strings,
  one per invalid field.

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

**Auth:** `Authorization: Bearer <supabase-jwt>`

**Response — `200 OK`**
```json
{
  "id": "3f2e6b1a-...-uuid",
  "email": "user@example.com",
  "createdAt": "2026-08-29T10:00:00.000Z"
}
```

**Errors**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing `Authorization` header, or the token is invalid/expired |

---

### `POST /api-keys`

Generates a new API key for the logged-in user. **The raw key is returned
only in this response — copy it now.** Only its SHA-256 hash and a display
prefix are ever persisted.

**Auth:** `Authorization: Bearer <supabase-jwt>`

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

**Auth:** `Authorization: Bearer <supabase-jwt>`

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

**Auth:** `Authorization: Bearer <supabase-jwt>`

**Path params**
| Param | Type | Notes |
|---|---|---|
| `id` | string (uuid) | The `id` field from `POST`/`GET /api-keys` — not the raw key itself |

**Response — `204 No Content`** (empty body)

**Errors**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing/invalid bearer token |
| `404 Not Found` | The key doesn't exist, isn't owned by the caller, or is already revoked |

---

### `GET /usage`

Aggregate call counts for the logged-in user's own API keys, grouped by
service, day, and key.

**Auth:** `Authorization: Bearer <supabase-jwt>`

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

### `POST /shorten`

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
| `code` | string | The `code` field from `POST /shorten`'s response |

**Response — `302 Found`**, with a `Location` header set to the original
URL. Postman (like a browser) will follow this automatically unless you
disable redirect-following in its settings to inspect the header directly.

**Errors**
| Status | When |
|---|---|
| `404 Not Found` | No `ShortUrl` exists for that code |
| `429 Too Many Requests` | Rate limit exceeded |

---

## Postman setup

Recommended environment variables for a Postman collection:

| Variable | Example value | Set from |
|---|---|---|
| `baseUrl` | `http://localhost:3000` | Fixed |
| `jwt` | `eyJhbGciOi...` | `scripts/manual-google-login.html`'s output |
| `apiKey` | `nrn_ab12cd34...` | `POST /api-keys`'s `key` field, or the seed script |
| `shortCode` | `UgFiSdm` | `POST /shorten`'s `code` field |

Then:
- Dashboard requests: `{{baseUrl}}/me`, header `Authorization: Bearer {{jwt}}`
- Service requests: `{{baseUrl}}/shorten`, header `x-api-key: {{apiKey}}`
- Redirect check: `{{baseUrl}}/{{shortCode}}`

**Suggested end-to-end flow to exercise the whole API in one pass:**
1. `GET /health` — sanity check the server is up.
2. Get a JWT via `scripts/manual-google-login.html`, set `{{jwt}}`.
3. `GET /me` — confirms the JWT works and lazily creates your `User` row.
4. `POST /api-keys` — copy the `key` field into `{{apiKey}}`.
5. `GET /api-keys` — confirm it's listed (without the raw key).
6. `POST /shorten` with `{{apiKey}}` — copy the `code` field into
   `{{shortCode}}`.
7. `GET /{{shortCode}}` — confirm the redirect.
8. `GET /usage` with `{{jwt}}` — confirm a `url-shortener` row now shows a
   count of at least 1.
9. `DELETE /api-keys/:id` — revoke the key, then repeat step 6 and confirm
   it now returns `401`.
