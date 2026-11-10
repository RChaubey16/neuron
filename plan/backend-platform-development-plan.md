# Neuron: Platform Development Plan

## 1. Project Overview

**App name:** Neuron

### Objective

Build **Neuron**, a centralized backend platform that provides reusable
backend services through secure REST APIs.

Users will be able to:

-   Register and log in using Google OAuth.
-   Manage their profile through authenticated APIs.
-   Create and manage API keys.
-   Use API keys to authenticate requests to platform services.
-   Create, manage, and redirect shortened URLs.
-   Use the Neuron web app to log in, manage API keys, and read the API
    documentation.
-   Add additional backend services later, such as notifications, file
    storage, webhooks, and analytics.

### Phase 1 scope

The first release includes:

1.  Google OAuth authentication.
2.  User profile management.
3.  API key creation and management.
4.  API key authentication and scopes.
5.  URL shortener service.
6.  Web frontend: Google login, API key management, and API
    documentation.
7.  Automated tests, API documentation, and deployment.

### Technology stack

  Layer               Technology
  ------------------- ------------------------------------------------
  Repository          pnpm workspace monorepo (`apps/api`, `apps/web`)
  Backend framework   NestJS
  Language            TypeScript (ES modules)
  Runtime             Node.js 26 LTS
  Database            Supabase PostgreSQL
  Authentication      Supabase Auth + Google OAuth
  ORM                 Prisma ORM
  Migrations          Prisma Migrate
  API documentation   Swagger / OpenAPI
  Validation          class-validator, class-transformer
  Testing             Vitest, Supertest
  Package manager     pnpm
  Formatting          Prettier
  Linting             Oxlint (type-aware)
  Version control     Git
  Frontend            Next.js (App Router), React, TypeScript
  Frontend styling    Tailwind CSS
  Frontend auth       Supabase JS (`@supabase/ssr`), Google OAuth
  API reference UI    Scalar, rendered from the backend OpenAPI spec
  Local development   Docker Compose (all commands run in containers)
  API deployment      Docker on self-managed VPS via Coolify
  Web deployment      Vercel

### Key decisions

These decisions are final for Phase 1. The rest of this plan follows
them.

-   **Web frontend in Phase 1.** The Neuron web app covers Google
    login, profile, API key management, and public API documentation.
    URL management in the web app is deferred: users manage URLs
    through the API. "User APIs" in this plan means the APIs called
    with a Supabase login token (JWT).
-   **Login happens in the web app.** The browser signs in with Google
    through Supabase JS and sends the resulting access token to NestJS
    as `Authorization: Bearer`. NestJS has no login endpoints of its
    own.
-   **Database access.** Supabase PostgreSQL is used as a plain Postgres
    database. Only NestJS talks to it, through Prisma ORM. Schema changes
    go through Prisma Migrate.
-   **Three hostnames.** The web app is served at `https://<domain>`
    (Vercel).
    The API is served at `https://api.<domain>/api/v1`. Redirects are
    served at `https://<short-domain>/:shortCode`. One NestJS app serves
    both the API and redirects, and the redirect route only responds
    when the request's host is the short domain. Real domain names are
    still to be chosen; placeholders are used until then.
-   **URL endpoints accept either a login token or an API key.** Scopes
    are checked only for API key requests. A request made with a login
    token can act on all of that user's own resources.
-   **API key format and hashing.** Keys look like
    `nrn_live_<prefix>_<secret>`. The `prefix` is a random public
    identifier used for lookup. The `secret` is at least 32 bytes from a
    secure random source. Only `HMAC-SHA256(secret, API_KEY_HMAC_SECRET)`
    is stored, and it is compared in constant time.
-   **Scopes and expiry are set when a key is created.** By default a
    new key gets all URL scopes and never expires.
-   **Short codes** are 6 random base62 characters (a–z, A–Z, 0–9),
    about 56.8 billion possible codes. Users cannot choose their own
    codes in Phase 1 (see Future Development).
-   **Soft delete.** Deleting a URL sets `deleted_at`. Deleted URLs stop
    redirecting and their short codes are never reused.
-   **Offset pagination.** List endpoints take `page` (default 1) and
    `limit` (default 20, max 100) query parameters and return `total`.
-   **Hosting.** The API (including redirects) runs as a Docker
    container on a self-managed VPS, deployed with Coolify. The web app
    is deployed on Vercel.
-   **Docker for development too.** Local development runs in Docker
    Compose. The API Dockerfile has a `dev` target (watch mode) and a
    `prod` target that Coolify deploys. The web Dockerfile is for local
    development only, because Vercel builds the web app itself.
    Only Docker and Git are needed on the host. Supabase stays in the
    cloud: development uses its own Supabase project, separate from
    production.
-   **Tooling follows NestJS 12 defaults.** The API is an ES module
    project (relative imports end in `.js`), linted with Oxlint and
    tested with Vitest and Supertest.
-   **Version control.** One Git repository (a pnpm workspace
    monorepo) holding both apps, with feature branches merged into
    `develop`. The repository link is still to be shared; this does not
    block development.

## 2. Architecture

Use a **modular monolith** for the first release. Each backend service
should be an independent NestJS module, while authentication, API key
validation, logging, and shared infrastructure remain reusable.

### Access paths

**User access (login token)**

1.  User signs in with Google through Supabase Auth.
2.  Supabase issues an access token (JWT).
3.  The Neuron web app (or any other client) sends the token to NestJS
    in the `Authorization: Bearer` header.
4.  NestJS validates the JWT and identifies the user.
5.  The user calls protected user APIs: profile, API keys, and URLs.

**Service API access**

1.  User creates an API key with their login token via
    `POST /api/v1/api-keys`.
2.  An external application sends the key in the `x-api-key` header.
3.  NestJS validates the key and resolves its owner and scopes.
4.  The request is routed to the relevant service module.

URL endpoints accept either path (see Key decisions).

**Public redirect access**

1.  Anyone opens `https://<short-domain>/:shortCode`.
2.  NestJS looks up the code and redirects to the original URL.

### Architecture flow

``` text
Neuron web app / user client        External Application
   |                                       |
   | Google OAuth (Supabase Auth)          | x-api-key
   | Authorization: Bearer <JWT>           |
   v                                       v
NestJS JWT Guard                    NestJS API Key Guard
   |                                       | validate key, expiry,
   |                                       | revocation, scopes
   +------------------+--------------------+
                      v
        User APIs / Service modules (api.<domain>/api/v1)
                      |
                      v  Prisma ORM
              Supabase PostgreSQL
                      ^
                      |
        Redirect controller (<short-domain>/:shortCode, public)
```

### Suggested project structure

``` text
neuron/
├── apps/
│   ├── api/                NestJS backend (+ Dockerfile)
│   └── web/                Next.js frontend (+ dev-only Dockerfile)
├── docker-compose.yml      Local development (api, web)
├── docker-compose.test.yml Disposable Postgres for integration tests
├── .dockerignore
├── .env.example
├── package.json
└── pnpm-workspace.yaml
```

Both Dockerfiles use the repository root as the build context, so the
shared `pnpm-lock.yaml` is available.

Backend (`apps/api`):

``` text
prisma/
├── schema.prisma
└── migrations/

src/
├── main.ts
├── app.module.ts
│
├── config/
│   ├── configuration.ts
│   └── validation.ts
│
├── common/
│   ├── decorators/
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   ├── pipes/
│   ├── constants/
│   └── interfaces/
│
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
│
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── guards/
│   └── strategies/
│
├── users/
│   ├── users.module.ts
│   ├── users.controller.ts
│   └── users.service.ts
│
├── api-keys/
│   ├── api-keys.module.ts
│   ├── api-keys.controller.ts
│   ├── api-keys.service.ts
│   ├── api-keys.repository.ts
│   └── dto/
│
├── url-shortener/
│   ├── url-shortener.module.ts
│   ├── url-shortener.controller.ts
│   ├── redirect.controller.ts
│   ├── url-shortener.service.ts
│   ├── url-shortener.repository.ts
│   └── dto/
│
└── health/
    ├── health.module.ts
    └── health.controller.ts
```

Frontend (`apps/web`):

``` text
app/
├── page.tsx                Landing page
├── login/                  Google sign-in
├── auth/callback/          OAuth callback (PKCE code exchange)
├── account/                Login required
│   ├── profile/
│   └── api-keys/
└── docs/                   Public
    ├── getting-started/
    ├── authentication/
    ├── errors/
    └── reference/          Scalar API reference
components/
lib/
├── supabase/               Browser and server Supabase clients
└── api/                    Typed API client generated from OpenAPI
content/docs/               MDX guides
```

## 3. Phase 0: Project Foundation

**Goal:** Establish the backend project, development environment, and
database connection.

### Feature 0.1: Initialize NestJS project

Tasks:

-   [ ] Create the pnpm workspace monorepo.
-   [ ] Create the NestJS application in `apps/api`.
-   [ ] Configure TypeScript.
-   [ ] Configure pnpm.
-   [ ] Configure Oxlint (NestJS 12 default, replaces ESLint).
-   [ ] Configure Vitest (NestJS 12 default, replaces Jest).
-   [ ] Configure Prettier.
-   [ ] Configure path aliases.
-   [ ] Establish environment variable management.
-   [ ] Create the initial module structure.
-   [ ] Add a global API prefix: `/api/v1`.
-   [ ] Configure global validation pipes.
-   [ ] Configure CORS.
-   [ ] Configure a global exception filter.

**Commit:** `chore: initialize nestjs backend project`

### Feature 0.2: Docker development environment

All development runs in Docker, so local and production use the same
runtime.

Tasks:

-   [ ] Write a multi-stage `apps/api/Dockerfile` with `dev` and `prod`
    targets. Base it on `node:<LTS>-slim` (Debian) with the Node version
    pinned. Avoid Alpine, which causes Prisma engine issues with musl
    and OpenSSL.
-   [ ] Enable pnpm through Corepack, pinned to the version in
    `package.json`. Node 25+ no longer bundles Corepack, so install it
    with npm first.
-   [ ] Create `docker-compose.yml` with an `api` service that uses the
    `dev` target, bind-mounts the source, runs in watch mode, and
    exposes port 3000.
-   [ ] Keep `node_modules` in a named volume so macOS-built packages
    never reach the Linux container.
-   [ ] Load environment variables from a git-ignored `.env`, and
    commit `.env.example`.
-   [ ] Add `.dockerignore`.
-   [ ] Run all project commands inside the container, for example
    `docker compose exec api pnpm test` and
    `docker compose exec api pnpm prisma migrate dev`. Document them in
    the README.
-   [ ] Confirm hot reload works on bind mounts. Turn on file polling
    only if file change events are not detected.
-   [ ] Confirm the `prod` target builds and runs locally
    (`docker build --target prod`).

**Commit:** `chore: add docker development environment`

### Feature 0.3: Supabase database integration

Tasks:

-   [ ] Create the Supabase project.
-   [ ] Install Prisma and create `prisma/schema.prisma`.
-   [ ] Configure `DATABASE_URL` (Supabase pooler connection string,
    used by the app at runtime) and `DIRECT_URL` (direct or session
    pooler connection string, used by Prisma Migrate). If the VPS has
    no IPv6, use the session pooler, because Supabase direct connections
    are IPv6 only by default.
-   [ ] Create a global `PrismaModule` and `PrismaService` that connect
    on startup and disconnect on shutdown.
-   [ ] Establish the migration workflow: `prisma migrate dev` locally,
    `prisma migrate deploy` in production.
-   [ ] Plan for foreign keys to `auth.users`: Prisma does not manage
    the `auth` schema, so add those constraints with custom SQL inside
    Prisma migrations.
-   [ ] Test database connectivity.
-   [ ] Use a separate Supabase project for development; the local
    containers connect to it. Production uses its own project.

**Commit:** `feat: integrate supabase database with prisma`

### Feature 0.4: Health check API

Tasks:

-   [ ] Create the health module.
-   [ ] Create `GET /api/v1/health`.
-   [ ] Check application status.
-   [ ] Check database connectivity.
-   [ ] Return a structured health response.

**Commit:** `feat: add application health check endpoint`

### Phase 0 completion criteria

-   [ ] Application starts with `docker compose up`.
-   [ ] The `prod` Docker target builds and runs.
-   [ ] Environment configuration works.
-   [ ] Supabase connection works.
-   [ ] Database migrations can run.
-   [ ] Health check API works.
-   [ ] Swagger is accessible.

------------------------------------------------------------------------

## 4. Phase 1: Authentication System

**Goal:** Allow users to authenticate through Google OAuth.

### Feature 1.1: Configure Supabase Google OAuth

Tasks:

-   [ ] Configure a Google Cloud OAuth application.
-   [ ] Configure Google OAuth credentials.
-   [ ] Enable the Google provider in Supabase Auth.
-   [ ] Configure authorized redirect URLs.
-   [ ] Configure Supabase authentication settings.
-   [ ] Test the OAuth login flow.
-   [ ] Add the web app callback URLs (local and production) to the
    Supabase redirect allowlist.

**Commit:** `feat: configure google oauth authentication`

### Feature 1.2: Authentication integration in NestJS

Tasks:

-   [ ] Create `AuthModule`.
-   [ ] Integrate Supabase Auth.
-   [ ] Implement Supabase JWT validation.
-   [ ] Create an authentication guard.
-   [ ] Validate JWT signature, issuer, audience, expiry, and claims.
-   [ ] Create a reusable `@CurrentUser()` decorator.
-   [ ] Extract the authenticated user ID from the JWT.
-   [ ] Implement authentication error handling.

**Commit:** `feat: implement supabase jwt authentication`

### Feature 1.3: User management

Tasks:

-   [ ] Create `UsersModule`.
-   [ ] Create a user profile table.
-   [ ] Synchronize the application profile after first login.
-   [ ] Store user ID, email, full name, avatar URL, and timestamps.
-   [ ] Implement `GET /api/v1/users/me`.
-   [ ] Implement `PATCH /api/v1/users/me`.

**Commit:** `feat: implement user profile management`

### Feature 1.4: Protected routes

Tasks:

-   [ ] Apply the JWT authentication guard.
-   [ ] Protect user APIs.
-   [ ] Allow public access only to explicitly public endpoints.
-   [ ] Test unauthorized requests.
-   [ ] Test expired and invalid JWTs.

**Commit:** `feat: implement protected user routes`

### Phase 1 completion criteria

-   [ ] Google login works.
-   [ ] Authenticated users can access their profiles.
-   [ ] Unauthenticated users cannot access protected user APIs.
-   [ ] Invalid and expired tokens are rejected.
-   [ ] User profiles are synchronized correctly.

------------------------------------------------------------------------

## 5. Phase 2: API Key Management

**Goal:** Allow authenticated users to create API keys and use them to
access platform services.

### Feature 2.1: API key database design

Create an `api_keys` table.

  Field            Description
  ---------------- ----------------------------------
  `id`             UUID primary key
  `user_id`        Owner's user ID
  `name`           Human-readable API key name
  `key_prefix`     Non-secret identification prefix
  `key_hash`       Secure hash of the API key
  `scopes`         Permitted API permissions
  `expires_at`     Optional expiration timestamp
  `last_used_at`   Last successful usage
  `revoked_at`     Revocation timestamp
  `created_at`     Creation timestamp

Security requirements:

-   Generate high-entropy API keys using a cryptographically secure
    random generator.
-   Never store raw API keys in the database.
-   Store only a secure hash of each key.
-   Show the complete API key only once, immediately after creation.
-   Use a recognizable, non-secret prefix to identify keys.
-   Never expose API keys in application logs.
-   Key format: `nrn_live_<prefix>_<secret>`. The `prefix` is stored in
    plain text with a unique index and used for lookup.
-   Hash with HMAC-SHA256 using a server-side secret
    (`API_KEY_HMAC_SECRET`) that is never stored in the database.
    Password hashing (bcrypt/argon2) is not needed because keys are
    high-entropy random values, and it would slow down every request.
-   Compare hashes with `crypto.timingSafeEqual`.

**Commit:** `feat: create api keys database schema`

### Feature 2.2: API key generation

Tasks:

-   [ ] Implement the API key generation service.
-   [ ] Generate cryptographically secure random tokens.
-   [ ] Add a recognizable key prefix.
-   [ ] Hash generated keys before database storage.
-   [ ] Associate API keys with authenticated users.
-   [ ] Return the raw key only during creation.
-   [ ] Support API key names.
-   [ ] Accept scopes when creating a key; default to all URL scopes.
-   [ ] Reject unknown scopes.
-   [ ] Accept an optional `expiresAt`, which must be in the future.
-   [ ] Add unit tests for generation and storage behavior.

Endpoint: `POST /api/v1/api-keys`

Request:

``` json
{
  "name": "Production Application",
  "scopes": ["urls:read", "urls:write", "urls:delete"],
  "expiresAt": null
}
```

`scopes` and `expiresAt` are optional.

Example response:

``` json
{
  "id": "uuid",
  "name": "Production Application",
  "apiKey": "your-generated-secret",
  "createdAt": "timestamp"
}
```

The response above is illustrative. The actual API key must be returned
only once.

**Commit:** `feat: implement api key generation`

### Feature 2.3: API key listing

Tasks:

-   [ ] Implement API key listing.
-   [ ] Return only keys belonging to the authenticated user.
-   [ ] Return the key prefix, never the secret.
-   [ ] Include creation date, expiration, and last-used date.
-   [ ] Add offset pagination (`page`, `limit`).

Endpoint: `GET /api/v1/api-keys`

**Commit:** `feat: implement api key listing`

### Feature 2.4: API key revocation

Tasks:

-   [ ] Implement API key revocation.
-   [ ] Verify key ownership.
-   [ ] Prevent revoked keys from authenticating.
-   [ ] Preserve records for audit purposes.

Endpoint: `DELETE /api/v1/api-keys/:id`

**Commit:** `feat: implement api key revocation`

### Feature 2.5: API key authentication guard

Tasks:

-   [ ] Create a reusable API key authentication guard.
-   [ ] Extract the API key from the `x-api-key` header.
-   [ ] Parse the key format and reject malformed keys early.
-   [ ] Locate the key by its `prefix`.
-   [ ] Compute the HMAC of the presented secret and compare it with
    the stored hash in constant time.
-   [ ] Check whether the key exists.
-   [ ] Check expiration.
-   [ ] Check revocation status.
-   [ ] Resolve the associated user.
-   [ ] Attach API key and user context to the request.
-   [ ] Update `last_used_at` without unnecessary database writes.
-   [ ] Ensure secret values are never logged.

Example request:

``` http
GET /api/v1/urls
x-api-key: your-generated-secret
```

**Commit:** `feat: implement api key authentication guard`

### Feature 2.6: API key scopes and permissions

Tasks:

-   [ ] Define service-level permissions.
-   [ ] Implement scope validation.
-   [ ] Associate scopes with API keys.
-   [ ] Create a reusable scope decorator and guard.
-   [ ] Reject requests without the required permission.
-   [ ] Add tests for allowed and denied scopes.

Example scopes:

``` text
urls:read
urls:write
urls:delete
notifications:send
```

For the first release, implement URL-related scopes only.

Scopes are checked only for API key requests. Endpoints that accept
either a login token or an API key use a combined guard, for example
`JwtOrApiKeyGuard`. Requests made with a login token skip the scope
check, but ownership checks still apply.

**Commit:** `feat: implement api key scopes and permissions`

### Phase 2 completion criteria

-   [ ] Users can create API keys.
-   [ ] Users can list their own keys.
-   [ ] Users can revoke their own keys.
-   [ ] Raw keys are never stored.
-   [ ] Revoked and expired keys are rejected.
-   [ ] API key authentication works.
-   [ ] Scope validation works.
-   [ ] One user cannot manage another user's API keys.

------------------------------------------------------------------------

## 6. Phase 3: URL Shortener Service

**Goal:** Build the first service that can be consumed using generated
API keys.

### Feature 3.1: URL database design

Create a `short_urls` table.

  -----------------------------------------------------------------------
  Field                               Description
  ----------------------------------- -----------------------------------
  `id`                                UUID primary key

  `user_id`                           Owner's user ID

  `api_key_id`                        API key used to create the URL;
                                      null when created with a login
                                      token

  `short_code`                        Unique 6-character base62
                                      identifier

  `original_url`                      Original destination

  `is_active`                         Whether the URL is active

  `expires_at`                        Optional expiration

  `click_count`                       Total redirect count

  `created_at`                        Creation timestamp

  `updated_at`                        Last update timestamp

  `deleted_at`                        Soft-delete timestamp; null if not
                                      deleted
  -----------------------------------------------------------------------

Database requirements:

-   [ ] Unique constraint on `short_code`.
-   [ ] Index on `user_id`.
-   [ ] Index on `api_key_id`, if used.
-   [ ] Index on `created_at`.
-   [ ] Appropriate foreign keys and constraints.
-   [ ] Ownership checks on all user-managed records.

Each short URL should have a direct `user_id` ownership reference. Do
not rely only on the API key relationship for ownership.

**Commit:** `feat: create url shortener database schema`

### Feature 3.2: Short code generation

Tasks:

-   [ ] Implement a short code generator.
-   [ ] Use cryptographically secure random generation.
-   [ ] Generate 6-character base62 codes (a–z, A–Z, 0–9), using
    rejection sampling to avoid modulo bias.
-   [ ] Check for collisions.
-   [ ] Retry generation if a collision occurs.
-   [ ] Enforce the unique database constraint.
-   [ ] Test collision handling.

Example:

``` text
https://<short-domain>/aB3x9Z
```

**Commit:** `feat: implement short url code generation`

### Feature 3.3: Create short URL API

Tasks:

-   [ ] Implement the URL creation endpoint.
-   [ ] Authenticate with either a login token or an API key.
-   [ ] Validate the original URL.
-   [ ] Allow only supported URL schemes, normally HTTP and HTTPS.
-   [ ] Generate a short code.
-   [ ] Save the URL to the database.
-   [ ] Return the shortened URL.
-   [ ] Support an optional expiration date.
-   [ ] Require the `urls:write` scope for API key requests.
-   [ ] Build `shortUrl` from the `SHORT_URL_BASE` setting.

Endpoint: `POST /api/v1/urls`

Request:

``` json
{
  "url": "https://example.com/some-long-url",
  "expiresAt": null
}
```

Example response:

``` json
{
  "id": "uuid",
  "shortCode": "aB3x9Z",
  "shortUrl": "https://<short-domain>/aB3x9Z",
  "originalUrl": "https://example.com/some-long-url"
}
```

**Commit:** `feat: implement create short url api`

### Feature 3.4: Redirect API

Tasks:

-   [ ] Create a public redirect endpoint.
-   [ ] Accept the short code as a route parameter.
-   [ ] Find the corresponding URL.
-   [ ] Serve the route only on the short domain (check the `Host`
    header); other hosts get 404.
-   [ ] Verify that the URL is active and not soft-deleted.
-   [ ] Verify expiration.
-   [ ] Redirect using HTTP 302 initially.
-   [ ] Return 404 for unknown codes.
-   [ ] Return an appropriate response for expired or disabled URLs.
-   [ ] Validate destination URLs at creation time.
-   [ ] Consider abuse controls and malicious destination reporting.

Endpoint: `GET https://<short-domain>/:shortCode`. It is public and
sits outside the `/api/v1` prefix.

Expected behavior:

``` text
Browser
   |
   v
Short URL
   |
   v
Backend lookup
   |
   v
Original URL
```

**Commit:** `feat: implement short url redirection`

### Feature 3.5: URL listing API

Tasks:

-   [ ] Implement URL listing.
-   [ ] Return URLs belonging to the authenticated user.
-   [ ] Support offset pagination (`page`, `limit`).
-   [ ] Support search by original URL or short code.
-   [ ] Support filtering by active status.
-   [ ] Exclude soft-deleted URLs.
-   [ ] Accept a login token or an API key; require `urls:read` for API
    key requests.

Endpoint: `GET /api/v1/urls`

**Commit:** `feat: implement url listing api`

### Feature 3.6: URL details API

Tasks:

-   [ ] Retrieve a URL by ID.
-   [ ] Accept a login token or an API key; require `urls:read` for API
    key requests.
-   [ ] Verify ownership.
-   [ ] Return original URL and short URL.
-   [ ] Return creation date, expiration, and click count.

Endpoint: `GET /api/v1/urls/:id`

**Commit:** `feat: implement url details api`

### Feature 3.7: Update and delete URL APIs

Tasks:

-   [ ] Implement URL deactivation.
-   [ ] Implement URL reactivation.
-   [ ] Implement soft deletion by setting `deleted_at`. Deleted URLs
    stop redirecting, are hidden from lists, and their codes are never
    reused.
-   [ ] Verify ownership.
-   [ ] Accept a login token or an API key; require `urls:write`
    (PATCH) or `urls:delete` (DELETE) for API key requests.
-   [ ] Prevent unauthorized modifications.

Suggested endpoints:

-   `PATCH /api/v1/urls/:id`
-   `DELETE /api/v1/urls/:id`

**Commit:** `feat: implement url update and delete apis`

### Feature 3.8: Click tracking

Tasks:

-   [ ] Increment click count on successful redirects.
-   [ ] Avoid lost updates under concurrent requests.
-   [ ] Use Prisma's atomic `increment`, which runs a single
    `UPDATE ... SET click_count = click_count + 1`.
-   [ ] Record basic click analytics if required.
-   [ ] Define whether bot traffic and repeated requests count as
    clicks.

For the initial version, maintain total click count only.

**Commit:** `feat: implement url click tracking`

### Phase 3 completion criteria

-   [ ] Users can create short URLs using API keys.
-   [ ] Public visitors can access shortened URLs.
-   [ ] Redirects work correctly.
-   [ ] Users can view and manage their URLs.
-   [ ] API key scopes are enforced.
-   [ ] Click counts are accurate under concurrent requests.
-   [ ] Expired and disabled URLs cannot redirect.

------------------------------------------------------------------------

## 7. Phase 4: Web Frontend

**Goal:** Give users a web app to log in, manage their API keys, and
read the API documentation.

The frontend depends on the user APIs (Phase 1), the API key APIs
(Phase 2), and the OpenAPI spec (Swagger, set up in Phase 0 and
completed in Feature 5.5).

### Feature 4.1: Frontend project setup

Tasks:

-   [ ] Create the Next.js app (TypeScript, App Router) in `apps/web`.
-   [ ] Write a development-only `apps/web/Dockerfile` (Vercel handles
    production builds).
-   [ ] Add a `web` service (port 3001) to `docker-compose.yml`.
-   [ ] Configure Tailwind CSS.
-   [ ] Share Prettier configuration with `apps/api`.
-   [ ] Configure environment variables: `NEXT_PUBLIC_SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_API_BASE_URL`.
-   [ ] Generate a typed API client from the backend OpenAPI spec (for
    example with `openapi-typescript`).
-   [ ] Create the base layout, navigation, and landing page.

**Commit:** `chore: initialize next.js web frontend`

### Feature 4.2: Google login

Tasks:

-   [ ] Implement "Sign in with Google" using Supabase JS (PKCE flow).
-   [ ] Implement the `/auth/callback` route that exchanges the code for
    a session.
-   [ ] Store the session with `@supabase/ssr` cookies and let Supabase
    refresh tokens automatically.
-   [ ] Send the access token as `Authorization: Bearer` on every API
    call.
-   [ ] Call `GET /api/v1/users/me` after login so the profile is
    synchronized.
-   [ ] Implement logout.
-   [ ] Redirect logged-out users from `/account/*` to `/login`.
-   [ ] Handle expired sessions and API 401 responses.

**Commit:** `feat: add google login to web app`

### Feature 4.3: Profile and API key management

Tasks:

-   [ ] Profile page: show and edit name and avatar via
    `GET`/`PATCH /api/v1/users/me`.
-   [ ] API key list: name, prefix, scopes, created, expires, last used,
    and status, with pagination.
-   [ ] Create key form: name, scope checkboxes (all URL scopes checked
    by default), and optional expiry date.
-   [ ] Show the full key once in a dialog with a copy button and a
    warning that it will not be shown again.
-   [ ] Never store the raw key in browser storage, URLs, or logs.
-   [ ] Revoke a key after a confirmation step.
-   [ ] Show loading, empty, and error states.

**Commit:** `feat: add profile and api key management ui`

### Feature 4.4: API documentation pages

All documentation pages are public and need no login.

Tasks:

-   [ ] Getting started: log in, create an API key, and make a first
    request with `curl`.
-   [ ] Authentication: login token vs `x-api-key`, and a table of
    scopes and the endpoints that need them.
-   [ ] Errors and rate limits: error response format, status codes,
    and HTTP 429 behavior.
-   [ ] API reference: render the backend OpenAPI spec with Scalar,
    served by NestJS at `/api/v1/openapi.json`.
-   [ ] Code examples in `curl`, JavaScript, and Python.
-   [ ] Write the guides in MDX under `content/docs/`.

**Commit:** `feat: add api documentation pages`

### Feature 4.5: Frontend deployment (Vercel)

Tasks:

-   [ ] Import the Git repository into Vercel and set the project's
    root directory to `apps/web`. Vercel detects the pnpm workspace.
-   [ ] Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
    and `NEXT_PUBLIC_API_BASE_URL` in Vercel for the Production and
    Preview environments. Next.js bakes these in at build time.
-   [ ] Add the custom domain `<domain>` in Vercel and point DNS at it.
-   [ ] Turn on skipping of builds when a commit does not change
    `apps/web`, so API-only commits do not trigger web deploys.
-   [ ] Add `https://<domain>` to the backend CORS allowlist, and add
    its callback URL to the Supabase redirect allowlist.
-   [ ] Decide whether preview deployments support login. If they do,
    allow only this project's Vercel preview URL pattern in CORS and in
    the Supabase redirect allowlist; never allow all of `*.vercel.app`.
    If they don't, previews show only the public docs pages.

**Commit:** `chore: deploy web frontend`

### Phase 4 completion criteria

-   [ ] Users can sign in with Google and sign out.
-   [ ] Users can view and edit their profile.
-   [ ] Users can create, list, and revoke API keys from the web app.
-   [ ] The full API key is shown only once.
-   [ ] Documentation pages and the API reference load without login.
-   [ ] The API reference matches the deployed backend.

------------------------------------------------------------------------

## 8. Phase 5: Security, Testing, and Stabilization

**Goal:** Make the first release reliable and safe to expose to external
applications.

### Feature 5.1: Rate limiting

Tasks:

-   [ ] Implement global rate limiting.
-   [ ] Add API key-level rate limiting.
-   [ ] Add stricter limits to URL creation.
-   [ ] Add limits to public redirect endpoints where appropriate.
-   [ ] Return HTTP 429 when limits are exceeded.
-   [ ] Use in-memory storage (`@nestjs/throttler`). Phase 1 runs a
    single instance on the VPS. Move to a shared store only when
    scaling to multiple instances.

**Commit:** `feat: implement api rate limiting`

### Feature 5.2: Security hardening

Tasks:

-   [ ] Validate all incoming payloads.
-   [ ] Configure security headers.
-   [ ] Restrict CORS to the web app origins (local, production, and
    this project's Vercel previews if enabled).
-   [ ] Ensure secrets are not exposed.
-   [ ] Enable RLS on every table in the `public` schema, with no
    policies, so the Supabase Data API (anon key) cannot read them.
    Prisma connects as the table owner and is not affected.
-   [ ] Keep database URLs, `API_KEY_HMAC_SECRET`, and Supabase keys
    server-side only.
-   [ ] Protect against SQL injection.
-   [ ] Protect against cross-user resource access.
-   [ ] Implement request size limits.
-   [ ] Add security-focused logging.
-   [ ] Review redirect and URL validation behavior.
-   [ ] Ensure error responses do not expose sensitive internals.

**Commit:** `security: harden api and database access`

### Feature 5.3: Unit testing

Tasks:

-   [ ] Test authentication services.
-   [ ] Test API key generation.
-   [ ] Test API key validation.
-   [ ] Test scope validation.
-   [ ] Test short code generation.
-   [ ] Test URL creation.
-   [ ] Test redirects.
-   [ ] Test URL ownership validation.

**Commit:** `test: add unit tests for core modules`

### Feature 5.4: Integration and end-to-end testing

Run integration and e2e tests in Docker against a disposable Postgres
container (`docker-compose.test.yml`), never against the shared
Supabase project. The test setup creates a stub `auth.users` table and
signs test JWTs with a test key, so the JWT verification key must be
configurable.

Test the complete workflow:

1.  User logs in.
2.  User creates an API key.
3.  User creates a short URL.
4.  An external client accesses the short URL.
5.  User lists created URLs.
6.  User revokes the API key.
7.  The revoked API key can no longer access protected service
    endpoints.

Also test:

-   [ ] Invalid API keys.
-   [ ] Expired API keys.
-   [ ] Revoked API keys.
-   [ ] Missing scopes.
-   [ ] Cross-user resource access.
-   [ ] Invalid URLs.
-   [ ] Expired shortened URLs.
-   [ ] Duplicate short codes.
-   [ ] Concurrent click updates.

**Commit:** `test: add integration and e2e tests`

### Feature 5.5: Swagger documentation

Tasks:

-   [ ] Configure Swagger.
-   [ ] Document login token (Bearer JWT) authentication.
-   [ ] Document API key usage.
-   [ ] Document URL shortener endpoints.
-   [ ] Add request and response examples.
-   [ ] Document error responses.
-   [ ] Document required scopes.

**Commit:** `docs: add swagger api documentation`

### Feature 5.6: Deployment

Tasks:

-   [ ] Create the API application in Coolify from the Git repository,
    using the `prod` target of `apps/api/Dockerfile` with the repo root
    as build context.
-   [ ] Configure production environment variables in Coolify.
-   [ ] Configure production Supabase connectivity from the VPS (check
    IPv6 support or use the pooler).
-   [ ] Enable auto-deploy on push to the release branch.
-   [ ] Run `prisma migrate deploy` before the app starts on each
    deploy.
-   [ ] Point both `api.<domain>` and `<short-domain>` at the app in
    Coolify, with automatic HTTPS (Let's Encrypt).
-   [ ] Configure the Coolify health check to use `/api/v1/health`.
-   [ ] Configure logging and error monitoring.
-   [ ] Verify production APIs.
-   [ ] Document rollback and recovery procedures.

**Commit:** `chore: prepare backend for production deployment`

------------------------------------------------------------------------

## 9. Future Development Phases

These features are outside the first release. The architecture should
allow them to be added without rebuilding API key authentication.

### Phase 6: Notification Service

Features:

-   Email notifications.
-   SMS notifications.
-   Push notifications.
-   Notification templates.
-   Notification history.
-   Delivery status.
-   Provider integrations.

Example scopes:

``` text
notifications:send
notifications:read
```

### Phase 7: Webhook Management

Features:

-   Create webhooks.
-   Configure event subscriptions.
-   Send webhook events.
-   Implement retry mechanisms.
-   Implement webhook signatures.
-   Maintain delivery logs.

### Phase 8: File Storage Service

Features:

-   File upload API.
-   File download API.
-   Storage buckets.
-   File metadata.
-   File access permissions.
-   Signed download URLs.

### Phase 9: Analytics and Usage Management

Features:

-   API request tracking.
-   API usage dashboard.
-   Usage by API key.
-   Service-level usage metrics.
-   Request logs.
-   Usage quotas.
-   Billing integration.

### Phase 10: Platform Management

Features:

-   User management.
-   Service enable/disable controls.
-   API key management.
-   Usage monitoring.
-   Platform-level configuration.
-   Administrative dashboard.

### Other deferred features

-   **Custom short codes.** Users choose their own codes, with
    validation, a reserved-word list, and availability checks.
-   **URL management in the web app.** Create, list, edit, and delete
    short URLs from the UI. It will call the existing URL APIs.

------------------------------------------------------------------------

## 10. Git Commit Strategy

Every completed feature must have its own commit. Do not wait until an
entire phase is complete to commit.

### Rules for Claude Code (also in `CLAUDE.md`)

-   Never add Claude or Claude Code as a co-author: no
    `Co-Authored-By` trailer for Claude in commits or PRs.
-   Write every commit message in Conventional Commits format, using
    the prefixes below.
-   After each feature commit, update `plan/progress.md`: the feature's
    status, commit hash, current status, and a log entry. Commit that
    update separately as `docs: update progress`.

### Commit convention

Use Conventional Commits:

  Prefix        Usage
  ------------- ---------------------------------------
  `feat:`       New feature
  `fix:`        Bug fix
  `test:`       Add or update tests
  `docs:`       Documentation changes
  `refactor:`   Code restructuring
  `chore:`      Project configuration and maintenance
  `security:`   Security improvements

### Example Git workflow

``` bash
# Start a feature branch
git checkout -b feature/api-key-generation

# Implement the feature
# Add tests
# Run lint and tests inside Docker
docker compose exec api pnpm lint
docker compose exec api pnpm test

# Stage changes
git add .

# Commit the completed feature
git commit -m "feat: implement api key generation"

# Merge into development
git checkout develop
git merge feature/api-key-generation

# Push changes
git push origin develop
```

### Feature completion checklist

A feature is complete only when:

-   [ ] Implementation is completed.
-   [ ] Input validation is implemented.
-   [ ] Error handling is implemented.
-   [ ] Relevant unit tests pass.
-   [ ] Integration tests are added where necessary.
-   [ ] Linting passes.
-   [ ] Existing functionality is not broken.
-   [ ] Documentation is updated where necessary.
-   [ ] Git commit is created.

If a feature fails any of these checks, do not mark it as completed.

------------------------------------------------------------------------

## 11. Recommended Database Tables

For the first release:

  Table          Purpose
  -------------- ---------------------------
  `profiles`     Application user profiles
  `api_keys`     API key management
  `short_urls`   URL shortener records

Supabase Auth manages authentication identities separately through its
own `auth.users` table.

### Relationships

``` text
auth.users
    |
    | 1:1
    |
profiles
    |
    | 1:N
    |
api_keys
    |
    | 1:N
    |
short_urls
```

Each short URL should also have a `user_id` ownership reference. Do not
rely only on the API key relationship for ownership.

------------------------------------------------------------------------

## 12. Development Milestones

  Milestone   Deliverable
  ----------- --------------------------------------------
  M0          NestJS foundation and Supabase integration
  M1          Google OAuth and user management
  M2          API key generation and management
  M3          API key authentication and scopes
  M4          URL creation and redirection
  M5          URL management and click tracking
  M6          Web frontend: login, API keys, and docs
  M7          Security and automated testing
  M8          Swagger and production deployment

### Phase 1 release acceptance criteria

The first production release is complete when this end-to-end workflow
works:

1.  A user logs in through Google on the Neuron web app.
2.  The user creates an API key in the web app.
3.  The user copies the generated API key.
4.  The user sends a request to the URL shortener API using that key.
5.  The backend validates the key.
6.  The backend creates a short URL.
7.  Anyone with the shortened URL can access it.
8.  The browser redirects to the original URL.
9.  The authenticated user can view URL information and usage.
10. The user can revoke the API key.

**Final outcome:** Neuron, a working backend platform with centralized
authentication, API key management, and its first reusable backend
service: URL Shortener.

------------------------------------------------------------------------

## 13. Important Architecture Recommendations

### 13.1 Keep Supabase Auth separate from NestJS business logic

Use Supabase for Google OAuth and user identity. NestJS should validate
Supabase-issued JWTs rather than implementing a second authentication
system.

### 13.2 Build API key authentication as shared infrastructure

Do not implement API key validation separately inside URL Shortener,
Notification, or other modules.

Create one reusable `ApiKeyGuard`:

``` text
ApiKeyGuard
    |
    ├── Validate API key
    ├── Check expiration
    ├── Check revocation
    ├── Identify user
    └── Attach API key context
             |
             ├── URL Shortener
             ├── Notification
             └── Other services
```

### 13.3 Keep API keys secure

Use high-entropy random API keys, store only their hashes, and show the
original key once. Use constant-time verification where applicable.
Never log secrets.

### 13.4 Separate public and protected endpoints

  Endpoint               Authentication
  ---------------------- ----------------------------------
  Google login           Supabase OAuth
  User profile           Supabase JWT
  Create/list/revoke     Supabase JWT
  API keys
  Short URL CRUD         Supabase JWT or API key (scoped)
  Redirect short URL     Public (short domain only)
  Health check           Public
  Web app docs pages     Public
  Web app account pages  Supabase login (browser session)

### 13.5 Avoid overengineering Phase 1

Avoid microservices, Redis, message queues, billing, and complex
analytics initially. A modular NestJS monolith with PostgreSQL is
sufficient. Add infrastructure when actual requirements justify it.

------------------------------------------------------------------------

## 14. Recommended Development Order

Follow this sequence:

1.  **Project foundation:** NestJS, Supabase, configuration, database,
    and health checks.
2.  **Authentication:** Google OAuth, JWT validation, and user profiles.
3.  **API key management:** Generation, listing, revocation, and secure
    storage.
4.  **API key authorization:** Authentication guard, scopes, and
    permissions.
5.  **URL shortener:** Database, short code generation, creation,
    redirects, and management.
6.  **Web frontend:** Login, profile, API key management, and
    documentation pages.
7.  **Production readiness:** Security, testing, documentation, and
    deployment.

**Development rule:** Every feature should be independently testable and
committed before moving to the next feature. This makes development
easier to track and debugging considerably easier.

------------------------------------------------------------------------

## 15. Open Questions

These do not block development. Placeholders are used until they are
answered.

1.  **Domains.** The web app domain, API domain, and short domain.
2.  **Repository.** The Git repository link.
