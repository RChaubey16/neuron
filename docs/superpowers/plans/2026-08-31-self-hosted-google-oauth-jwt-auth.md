# Self-Hosted Google OAuth + JWT Dashboard Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase-issued dashboard session JWTs with a Nest-driven Google OAuth authorization-code flow and a self-signed JWT, so Supabase becomes database-only.

**Architecture:** `passport-google-oauth20` drives the OAuth2 authorization-code exchange (`GET /auth/google` → Google → `GET /auth/google/callback`); `AuthService` finds-or-creates the local `User` by Google's `sub` and signs a JWT via `@nestjs/jwt`; a hand-rolled `JwtAuthGuard` (matching this codebase's existing guard style, not a passport strategy) verifies that JWT and replaces `SupabaseJwtGuard` on every dashboard route.

**Tech Stack:** NestJS 11, `@nestjs/jwt`, `@nestjs/passport` + `passport` + `passport-google-oauth20`, Prisma 7, Jest/ts-jest, supertest.

**Spec:** `docs/superpowers/specs/2026-08-30-self-hosted-google-oauth-jwt-auth-design.md`

## Global Constraints

- `jose` is removed entirely — nothing after this plan should import it.
- `SUPABASE_URL`/`SUPABASE_JWT_SECRET`/`SUPABASE_ANON_KEY` are removed from env validation and `.env.example` — Supabase is DB-only (`DATABASE_URL` only).
- New required env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `JWT_SECRET`, `FRONTEND_URL`. `JWT_EXPIRES_IN` is optional, defaults to `'7d'`.
- `JwtAuthGuard` is a hand-rolled `CanActivate` (same shape as the deleted `SupabaseJwtGuard`), not a passport strategy — only the Google leg uses passport.
- No Prisma migration — `User.id` stays `String @id`, just sourced from Google's `sub` instead of Supabase's UUID.
- `ApiKeyGuard` and machine auth are untouched by this plan.
- Every test file that currently does `jest.mock('jose', ...)` must stop doing so — tests override `JwtService`/`PrismaService` providers directly instead.

---

### Task 1: Env validation + config files

**Files:**
- Modify: `src/config/env.validation.ts`
- Modify: `src/config/env.validation.spec.ts`
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `EnvironmentVariables` class fields `GOOGLE_CLIENT_ID: string`, `GOOGLE_CLIENT_SECRET: string`, `GOOGLE_CALLBACK_URL: string`, `JWT_SECRET: string`, `JWT_EXPIRES_IN?: string`, `FRONTEND_URL: string`. `SUPABASE_URL` field removed. `validate()` signature unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/config/env.validation.spec.ts`:

```typescript
import { validate } from './env.validation';

describe('validate (environment variables)', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
    JWT_SECRET: 'test-jwt-secret',
    FRONTEND_URL: 'http://localhost:3001',
    PORT: '3000',
  };

  it('returns a validated config for a well-formed environment', () => {
    const result = validate(validEnv);

    expect(result.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(result.GOOGLE_CLIENT_ID).toBe(validEnv.GOOGLE_CLIENT_ID);
    expect(result.GOOGLE_CLIENT_SECRET).toBe(validEnv.GOOGLE_CLIENT_SECRET);
    expect(result.GOOGLE_CALLBACK_URL).toBe(validEnv.GOOGLE_CALLBACK_URL);
    expect(result.JWT_SECRET).toBe(validEnv.JWT_SECRET);
    expect(result.FRONTEND_URL).toBe(validEnv.FRONTEND_URL);
    expect(result.PORT).toBe(3000);
  });

  it('allows PORT and JWT_EXPIRES_IN to be omitted', () => {
    const { PORT: _omitPort, ...rest } = validEnv;
    const result = validate(rest);

    expect(result.PORT).toBeUndefined();
    expect(result.JWT_EXPIRES_IN).toBeUndefined();
  });

  it('accepts an explicit JWT_EXPIRES_IN', () => {
    const result = validate({ ...validEnv, JWT_EXPIRES_IN: '30d' });

    expect(result.JWT_EXPIRES_IN).toBe('30d');
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when GOOGLE_CLIENT_ID is missing', () => {
    const { GOOGLE_CLIENT_ID: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('throws when GOOGLE_CLIENT_SECRET is missing', () => {
    const { GOOGLE_CLIENT_SECRET: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('throws when GOOGLE_CALLBACK_URL is not a valid URL', () => {
    expect(() =>
      validate({ ...validEnv, GOOGLE_CALLBACK_URL: 'not-a-url' }),
    ).toThrow(/GOOGLE_CALLBACK_URL/);
  });

  it('accepts a localhost GOOGLE_CALLBACK_URL (no TLD)', () => {
    const result = validate({
      ...validEnv,
      GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
    });

    expect(result.GOOGLE_CALLBACK_URL).toBe(
      'http://localhost:3000/auth/google/callback',
    );
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/JWT_SECRET/);
  });

  it('throws when FRONTEND_URL is not a valid URL', () => {
    expect(() => validate({ ...validEnv, FRONTEND_URL: 'not-a-url' })).toThrow(
      /FRONTEND_URL/,
    );
  });

  it('throws when PORT is not a number', () => {
    expect(() => validate({ ...validEnv, PORT: 'not-a-number' })).toThrow(
      /PORT/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- env.validation.spec.ts`
Expected: FAIL — `GOOGLE_CLIENT_ID`/etc. don't exist on `EnvironmentVariables` yet, and the old `SUPABASE_URL`-based tests are gone so nothing passes by accident.

- [ ] **Step 3: Implement env validation**

Replace the full contents of `src/config/env.validation.ts`:

```typescript
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsString()
  DATABASE_URL: string;

  @IsString()
  GOOGLE_CLIENT_ID: string;

  @IsString()
  GOOGLE_CLIENT_SECRET: string;

  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  GOOGLE_CALLBACK_URL: string;

  @IsString()
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;

  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  FRONTEND_URL: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number;
}

/**
 * Validates `process.env` at startup so a missing/malformed required
 * variable fails fast with a clear message, instead of surfacing later as a
 * cryptic runtime error deep in whichever service first reads it.
 *
 * @param config - Raw environment variables, as passed by `ConfigModule`
 * @returns The validated, type-coerced configuration
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }
  return validated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- env.validation.spec.ts`
Expected: PASS

- [ ] **Step 5: Update `.env.example`**

Replace the full contents of `.env.example`:

```
# Copy to .env and fill in with your Google OAuth + Supabase Postgres values.

# App
PORT=3000
FRONTEND_URL="http://localhost:3001"

# Google OAuth (Google Cloud Console -> APIs & Services -> Credentials)
# GOOGLE_CALLBACK_URL must exactly match the redirect URI registered on this OAuth client.
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_CALLBACK_URL="http://localhost:3000/auth/google/callback"

# Session JWTs this app signs itself
JWT_SECRET="replace-with-a-long-random-secret"
JWT_EXPIRES_IN="7d"

# Supabase Postgres connection string (Project Settings -> Database) — Supabase is database-only now
DATABASE_URL="postgresql://postgres:password@db.your-project.supabase.co:5432/postgres?schema=public"
```

- [ ] **Step 6: Update CI env vars**

In `.github/workflows/ci.yml`, replace the `lint-and-build` job's comment and `env:` block:

```yaml
    # Tests never hit a real database, Supabase project, or Google OAuth
    # (PrismaService, JwtService, and the Google strategy are always
    # mocked/overridden in unit and e2e specs) — these only need to be
    # present and well-formed so ConfigModule's startup validation
    # (src/config/env.validation.ts) doesn't reject them.
    env:
      DATABASE_URL: postgresql://user:pass@localhost:5432/neuron_ci
      GOOGLE_CLIENT_ID: ci-placeholder-client-id
      GOOGLE_CLIENT_SECRET: ci-placeholder-client-secret
      GOOGLE_CALLBACK_URL: http://localhost:3000/auth/google/callback
      JWT_SECRET: ci-placeholder-jwt-secret
      FRONTEND_URL: http://localhost:3001
```

- [ ] **Step 7: Commit**

```bash
git add src/config/env.validation.ts src/config/env.validation.spec.ts .env.example .github/workflows/ci.yml
git commit -m "feat(config): validate Google OAuth + JWT env vars, drop Supabase auth vars"
```

---

### Task 2: Swap auth dependencies

**Files:**
- Modify: `package.json` (via `pnpm add`/`pnpm remove`, not hand-editing)

**Interfaces:**
- Produces: `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-google-oauth20` available as runtime imports; `@types/passport`, `@types/passport-google-oauth20` available for TS. `jose` no longer resolvable.

- [ ] **Step 1: Install new dependencies**

Run: `pnpm add @nestjs/jwt @nestjs/passport passport passport-google-oauth20`
Run: `pnpm add -D @types/passport @types/passport-google-oauth20`

- [ ] **Step 2: Verify the new deps resolve cleanly under ts-jest (CJS check)**

Run: `pnpm run test`
Expected: All existing tests still PASS (nothing imports the new packages yet, so this just proves `pnpm install` and Jest's module resolution aren't broken by the new packages — this codebase has repeatedly hit ESM-only-only-in-a-later-version breakage, e.g. `jose` 6.x, `nanoid` 4.x, `@nestjs/config` 12.x, so this check matters). If any new package fails to resolve or throws an ESM-related error, stop and report it before continuing — do not proceed to Task 3 with a broken dependency.

- [ ] **Step 3: Remove `jose`**

Run: `pnpm remove jose`

Note: this will make `src/auth/auth.service.ts` and its spec, plus every e2e spec doing `jest.mock('jose', ...)`, fail to compile/import — that's expected and gets fixed in Tasks 3, 7, and 8. Do not run the full test suite again until after Task 3.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: swap jose for @nestjs/jwt + passport-google-oauth20"
```

---

### Task 3: `AuthService` — find-or-create user + sign JWT

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService.user.upsert` (existing), `JwtService.signAsync` (from `@nestjs/jwt`, installed in Task 2).
- Produces: `export interface GoogleProfile { sub: string; email: string }`, `AuthService.findOrCreateUser(profile: GoogleProfile): Promise<User>`, `AuthService.signToken(user: User): Promise<string>`. `AuthService.verifyAndSyncUser` is removed — Task 7/8 update every caller.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/auth/auth.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { upsert: jest.Mock } };
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = { user: { upsert: jest.fn() } };
    jwtService = { signAsync: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('findOrCreateUser', () => {
    it('upserts a local User keyed by the Google sub', async () => {
      const user = { id: 'google-sub-1', email: 'user@example.com' };
      prisma.user.upsert.mockResolvedValue(user);

      const result = await service.findOrCreateUser({
        sub: 'google-sub-1',
        email: 'user@example.com',
      });

      expect(result).toEqual(user);
      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { id: 'google-sub-1' },
        update: {},
        create: { id: 'google-sub-1', email: 'user@example.com' },
      });
    });
  });

  describe('signToken', () => {
    it('signs a JWT encoding the user id and email', async () => {
      jwtService.signAsync.mockResolvedValue('signed.jwt.token');

      const result = await service.signToken({
        id: 'google-sub-1',
        email: 'user@example.com',
        createdAt: new Date('2026-08-30T00:00:00Z'),
      } as never);

      expect(result).toBe('signed.jwt.token');
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'google-sub-1',
        email: 'user@example.com',
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- auth.service.spec.ts`
Expected: FAIL — `findOrCreateUser`/`signToken` don't exist yet, `AuthService`'s constructor still requires `ConfigService` and calls `new URL()` on an undefined `SUPABASE_URL`.

- [ ] **Step 3: Implement `AuthService`**

Replace the full contents of `src/auth/auth.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '../../generated/prisma';

/** The subset of a verified Google OAuth profile AuthService needs. */
export interface GoogleProfile {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Finds the local `User` row for a Google account, creating it on this
   * user's first login.
   *
   * @param profile - The `sub`/`email` pulled from the verified Google OAuth profile
   * @returns The local User row matching the Google account
   */
  async findOrCreateUser(profile: GoogleProfile): Promise<User> {
    return this.prisma.user.upsert({
      where: { id: profile.sub },
      update: {},
      create: { id: profile.sub, email: profile.email },
    });
  }

  /**
   * Signs a Nest-issued session JWT for a local user.
   *
   * @param user - The local User row to encode
   * @returns A signed JWT string, expiring per `JWT_EXPIRES_IN`
   */
  async signToken(user: User): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id, email: user.email });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- auth.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat(auth): replace Supabase JWT verification with findOrCreateUser + signToken"
```

---

### Task 4: `JwtAuthGuard`

**Files:**
- Create: `src/auth/guards/jwt-auth.guard.ts`
- Create: `src/auth/guards/jwt-auth.guard.spec.ts`
- Delete: `src/auth/guards/supabase-jwt.guard.ts`
- Delete: `src/auth/guards/supabase-jwt.guard.spec.ts`

**Interfaces:**
- Consumes: `JwtService.verifyAsync<T>(token: string): Promise<T>` (from `@nestjs/jwt`), `PrismaService.user.findUniqueOrThrow`.
- Produces: `JwtAuthGuard` (`CanActivate`), attaches `User` to `request.user` on success — same contract `SupabaseJwtGuard` had, so `@CurrentUser()` needs no changes.

- [ ] **Step 1: Delete the old guard and its spec**

```bash
rm src/auth/guards/supabase-jwt.guard.ts src/auth/guards/supabase-jwt.guard.spec.ts
```

- [ ] **Step 2: Write the failing tests**

Create `src/auth/guards/jwt-auth.guard.spec.ts`:

```typescript
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: { user: { findUniqueOrThrow: jest.Mock } };

  const contextFor = (headers: Record<string, string> = {}) => {
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    prisma = { user: { findUniqueOrThrow: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
  });

  it('allows the request and attaches the user for a valid bearer token', async () => {
    const { context, request } = contextFor({
      authorization: 'Bearer valid-token',
    });
    const user = { id: 'user-1', email: 'user@example.com' };
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue(user);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
    expect(request.user).toBe(user);
  });

  it('throws UnauthorizedException when the Authorization header is missing', async () => {
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the Authorization header is not a Bearer token', async () => {
    const { context } = contextFor({ authorization: 'Basic abc123' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the token fails verification', async () => {
    const { context } = contextFor({ authorization: 'Bearer bad-token' });
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the token is valid but the user no longer exists', async () => {
    const { context } = contextFor({ authorization: 'Bearer valid-token' });
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'deleted-user',
      email: 'gone@example.com',
    });
    prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm run test -- jwt-auth.guard.spec.ts`
Expected: FAIL — `./jwt-auth.guard` doesn't exist yet.

- [ ] **Step 4: Implement `JwtAuthGuard`**

Create `src/auth/guards/jwt-auth.guard.ts`:

```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '../../../generated/prisma';

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Verifies the request's `Authorization: Bearer <token>` header and attaches the resolved user to the request. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: User }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    try {
      request.user = await this.prisma.user.findUniqueOrThrow({
        where: { id: payload.sub },
      });
    } catch {
      // Token is well-formed and unexpired, but its subject no longer has a
      // local User row (e.g. deleted after the token was issued).
      throw new UnauthorizedException('User no longer exists');
    }

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    return header.slice('Bearer '.length);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- jwt-auth.guard.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/auth/guards/jwt-auth.guard.ts src/auth/guards/jwt-auth.guard.spec.ts src/auth/guards/supabase-jwt.guard.ts src/auth/guards/supabase-jwt.guard.spec.ts
git commit -m "feat(auth): add JwtAuthGuard, remove SupabaseJwtGuard"
```

---

### Task 5: `GoogleStrategy`

**Files:**
- Create: `src/auth/strategies/google.strategy.ts`
- Create: `src/auth/strategies/google.strategy.spec.ts`

**Interfaces:**
- Consumes: `ConfigService.get<string>('GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'GOOGLE_CALLBACK_URL')`.
- Produces: `GoogleStrategy.validate(accessToken, refreshToken, profile, done)` calling `done(null, { sub, email } satisfies GoogleProfile)` on success, `done(error, false)` when the profile has no email — this is what Task 6's `AuthModule` registers as a provider and what `req.user` holds in Task 7's callback route.

- [ ] **Step 1: Write the failing tests**

Create `src/auth/strategies/google.strategy.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Profile } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                GOOGLE_CLIENT_ID: 'client-id',
                GOOGLE_CLIENT_SECRET: 'client-secret',
                GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
              })[key],
          },
        },
      ],
    }).compile();

    strategy = module.get(GoogleStrategy);
  });

  it('maps a verified Google profile to { sub, email }', () => {
    const done = jest.fn();
    const profile = {
      id: 'google-sub-1',
      emails: [{ value: 'user@example.com', verified: true }],
    } as unknown as Profile;

    strategy.validate('access-token', 'refresh-token', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      sub: 'google-sub-1',
      email: 'user@example.com',
    });
  });

  it('fails when the Google profile has no email', () => {
    const done = jest.fn();
    const profile = { id: 'google-sub-1', emails: [] } as unknown as Profile;

    strategy.validate('access-token', 'refresh-token', profile, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error), false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- google.strategy.spec.ts`
Expected: FAIL — `./google.strategy` doesn't exist yet.

- [ ] **Step 3: Implement `GoogleStrategy`**

Create `src/auth/strategies/google.strategy.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { GoogleProfile } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  /** Maps the verified Google profile to the `{ sub, email }` shape `AuthService` expects. */
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google profile has no email'), false);
      return;
    }
    const googleProfile: GoogleProfile = { sub: profile.id, email };
    done(null, googleProfile);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- google.strategy.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/strategies/google.strategy.ts src/auth/strategies/google.strategy.spec.ts
git commit -m "feat(auth): add GoogleStrategy for the OAuth authorization-code exchange"
```

---

### Task 6: Wire `AuthModule`

**Files:**
- Modify: `src/auth/auth.module.ts`

**Interfaces:**
- Consumes: `AuthService` (Task 3), `JwtAuthGuard` (Task 4), `GoogleStrategy` (Task 5).
- Produces: `AuthModule` exports `AuthService` and `JwtAuthGuard` (unchanged export surface from the callers' point of view — `ApiKeyModule`/`UsageModule` already import `AuthModule` and reference the guard by class).

- [ ] **Step 1: Implement `AuthModule`**

Replace the full contents of `src/auth/auth.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') ?? '7d',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
```

This task has no isolated test of its own — it only rewires DI. Its correctness is exercised by Task 7's e2e tests, which need the full module graph to compile. Do not run `pnpm run test` yet; `auth.controller.ts`, `api-keys.controller.ts`, and `usage.controller.ts` (all fixed together in Task 7) still reference the deleted `verifyAndSyncUser`/`SupabaseJwtGuard` at this point and won't compile until Task 7 lands.

- [ ] **Step 2: Commit**

```bash
git add src/auth/auth.module.ts
git commit -m "feat(auth): wire PassportModule + JwtModule into AuthModule"
```

---

### Task 7: `AuthController` (Google login routes + `/me`) and guard swap on `ApiKeyController`/`UsageController`

**Why this task covers three controllers, not one:** Task 4 deletes `src/auth/guards/supabase-jwt.guard.ts`, and Task 3 already removed the `AuthService.verifyAndSyncUser` method it called. At that point `auth.controller.ts`, `api-keys.controller.ts`, and `usage.controller.ts` all still reference the deleted guard, so `AppModule` cannot compile — and no e2e test that imports it can pass — until all three are switched to `JwtAuthGuard` together. Splitting this into two tasks (auth controller in one, api-keys/usage in another) would leave the first task's own e2e verification step asserting a pass it cannot actually get, since `AppModule` would still be broken by the other two.

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Create: `src/auth/auth.controller.spec.ts`
- Modify: `test/auth.e2e-spec.ts`
- Modify: `src/api-keys/api-keys.controller.ts`
- Modify: `src/usage/usage.controller.ts`
- Modify: `test/api-keys.e2e-spec.ts`
- Modify: `test/usage.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthService.findOrCreateUser`, `AuthService.signToken`, `GoogleProfile` (Task 3), `JwtAuthGuard` (Task 4), exported by `AuthModule` (Task 6) — `ApiKeyModule`/`UsageModule` already `imports: [AuthModule]`, no module-file changes needed there. `ConfigService.get<string>('FRONTEND_URL')`.
- Produces: `GET /auth/google`, `GET /auth/google/callback`, `GET /me`, `GET/POST /api-keys`, `DELETE /api-keys/:id`, `GET /usage` — all now guarded by `JwtAuthGuard`.

- [ ] **Step 1: Write the failing unit test for the callback handler**

Create `src/auth/auth.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { findOrCreateUser: jest.Mock; signToken: jest.Mock };

  beforeEach(async () => {
    authService = { findOrCreateUser: jest.fn(), signToken: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:3001' },
        },
      ],
    }).compile();

    controller = module.get(AuthController);
  });

  describe('googleCallback', () => {
    it('finds-or-creates the user, signs a token, and redirects with it', async () => {
      const user = { id: 'google-sub-1', email: 'user@example.com' };
      authService.findOrCreateUser.mockResolvedValue(user);
      authService.signToken.mockResolvedValue('signed.jwt.token');
      const req = {
        user: { sub: 'google-sub-1', email: 'user@example.com' },
      } as never;
      const res = { redirect: jest.fn() } as unknown as Response;

      await controller.googleCallback(req, res);

      expect(authService.findOrCreateUser).toHaveBeenCalledWith({
        sub: 'google-sub-1',
        email: 'user@example.com',
      });
      expect(authService.signToken).toHaveBeenCalledWith(user);
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3001/auth/callback#token=signed.jwt.token',
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- auth.controller.spec.ts`
Expected: FAIL — `AuthController.googleCallback` doesn't exist yet.

- [ ] **Step 3: Implement `AuthController`**

Replace the full contents of `src/auth/auth.controller.ts`:

```typescript
import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService, GoogleProfile } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserResponseDto } from './dto/user-response.dto';
import type { User } from '../../generated/prisma';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('auth/google')
  @UseGuards(AuthGuard('google'))
  googleLogin(): void {
    // AuthGuard('google') redirects to Google before this body runs.
  }

  @Get('auth/google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request & { user: GoogleProfile },
    @Res() res: Response,
  ): Promise<void> {
    const user = await this.authService.findOrCreateUser(req.user);
    const token = await this.authService.signToken(user);
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    res.redirect(`${frontendUrl}/auth/callback#token=${token}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@CurrentUser() user: User): UserResponseDto {
    return new UserResponseDto(user);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- auth.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Rewrite the e2e test for `/me`**

Replace the full contents of `test/auth.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('AuthController (e2e)', () => {
  let app: INestApplication<App>;
  const jwtServiceMock = { verifyAsync: jest.fn(), signAsync: jest.fn() };
  const prismaMock = {
    user: { upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(JwtService)
      .useValue(jwtServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('/me (GET) returns the logged-in user for a valid session token', async () => {
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
    });

    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect({ id: 'user-1', email: 'user@example.com' });

    expect(prismaMock.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('/me (GET) rejects requests without a token', () => {
    return request(app.getHttpServer()).get('/me').expect(401);
  });

  it('/me (GET) rejects an invalid token', () => {
    jwtServiceMock.verifyAsync.mockRejectedValue(new Error('jwt malformed'));

    return request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });
});
```

Note: this intentionally does not e2e-test `GET /auth/google` or `GET /auth/google/callback` — those require a real Google OAuth handshake (network calls to Google), which is exactly what Task 10's manual verification covers. `auth.controller.spec.ts` (Step 1-4 above) already unit-tests the callback handler's own logic in isolation from passport.

Note: do not run `pnpm run test:e2e -- auth.e2e-spec.ts` yet — `AppModule` still won't compile until Steps 6-8 below also fix `api-keys.controller.ts` and `usage.controller.ts`. The full verification for this task is Step 9.

- [ ] **Step 6: Swap the guard import in both controllers**

In `src/api-keys/api-keys.controller.ts`, change:

```typescript
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
```
to
```typescript
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
```
and change `@UseGuards(SupabaseJwtGuard)` to `@UseGuards(JwtAuthGuard)`.

In `src/usage/usage.controller.ts`, change:

```typescript
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
```
to
```typescript
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
```
and change `@UseGuards(SupabaseJwtGuard)` to `@UseGuards(JwtAuthGuard)`.

- [ ] **Step 7: Update `test/api-keys.e2e-spec.ts`**

Remove these two lines near the top of the file:

```typescript
import { jwtVerify } from 'jose';
```
and
```typescript
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));
```

Add this import alongside the other `src` imports:

```typescript
import { JwtService } from '@nestjs/jwt';
```

Replace:

```typescript
  const mockJwtVerify = jwtVerify as jest.Mock;
```
with
```typescript
  const jwtServiceMock = { verifyAsync: jest.fn() };
```

Replace the `prismaMock` declaration:

```typescript
  const prismaMock = {
    user: { upsert: jest.fn() },
    apiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
```
with
```typescript
  const prismaMock = {
    user: { findUniqueOrThrow: jest.fn() },
    apiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
```

Replace the `beforeEach` body:

```typescript
  beforeEach(async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: user.id, email: user.email },
    });
    prismaMock.user.upsert.mockResolvedValue(user);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestServiceController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
```
with
```typescript
  beforeEach(async () => {
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: user.id,
      email: user.email,
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(user);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestServiceController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(JwtService)
      .useValue(jwtServiceMock)
      .compile();
```

- [ ] **Step 8: Update `test/usage.e2e-spec.ts`**

Remove these two lines near the top of the file:

```typescript
import { jwtVerify } from 'jose';
```
and
```typescript
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));
```

Add this import alongside the other `src` imports:

```typescript
import { JwtService } from '@nestjs/jwt';
```

Replace:

```typescript
  const mockJwtVerify = jwtVerify as jest.Mock;
```
with
```typescript
  const jwtServiceMock = { verifyAsync: jest.fn() };
```

Replace the `prismaMock` declaration:

```typescript
  const prismaMock = {
    user: { upsert: jest.fn() },
    apiKey: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    usageLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };
```
with
```typescript
  const prismaMock = {
    user: { findUniqueOrThrow: jest.fn() },
    apiKey: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    usageLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };
```

Replace the `beforeEach` body:

```typescript
  beforeEach(async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: user.id, email: user.email },
    });
    prismaMock.user.upsert.mockResolvedValue(user);
    prismaMock.apiKey.update.mockResolvedValue({});
    prismaMock.usageLog.create.mockResolvedValue({});

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestServiceController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
```
with
```typescript
  beforeEach(async () => {
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: user.id,
      email: user.email,
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(user);
    prismaMock.apiKey.update.mockResolvedValue({});
    prismaMock.usageLog.create.mockResolvedValue({});

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestServiceController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(JwtService)
      .useValue(jwtServiceMock)
      .compile();
```

- [ ] **Step 9: Run the full unit + e2e suite for this task**

Run: `pnpm run test -- auth.controller.spec.ts auth.service.spec.ts jwt-auth.guard.spec.ts google.strategy.spec.ts env.validation.spec.ts`
Expected: PASS

Run: `pnpm run test:e2e -- auth.e2e-spec.ts api-keys.e2e-spec.ts usage.e2e-spec.ts`
Expected: PASS — this is the first point at which `AppModule` compiles again: every controller that used to reference `SupabaseJwtGuard` now references `JwtAuthGuard`, and the deleted guard file (Task 4) has no remaining consumers.

- [ ] **Step 10: Commit**

```bash
git add src/auth/auth.controller.ts src/auth/auth.controller.spec.ts test/auth.e2e-spec.ts src/api-keys/api-keys.controller.ts src/usage/usage.controller.ts test/api-keys.e2e-spec.ts test/usage.e2e-spec.ts
git commit -m "feat(auth): add Google login/callback routes, switch all dashboard routes to JwtAuthGuard"
```

---

### Task 8: Full suite check, Prisma doc comment, cleanup

**Files:**
- Modify: `prisma/schema.prisma`
- Delete: `scripts/manual-google-login.html`

**Interfaces:** none — this task is verification and cleanup only.

- [ ] **Step 1: Update the `User` model's doc comment**

In `prisma/schema.prisma`, replace:

```prisma
/// Synced lazily from Supabase `auth.users` on a user's first authenticated
/// request — `id` is the same UUID as the `auth.users` row, not Prisma-generated.
model User {
```
with
```prisma
/// Synced lazily from Google's OAuth profile on a user's first login —
/// `id` is Google's stable `sub` claim, not Prisma-generated.
model User {
```

No migration is needed — the column type/constraints are unchanged.

- [ ] **Step 2: Delete the now-obsolete manual login script**

```bash
rm scripts/manual-google-login.html
```

This page drove Supabase's client-side Google login, which no longer exists. Task 10's manual verification hits `GET /auth/google` directly in a browser instead — Nest itself now drives the redirect, so no standalone HTML page is needed to kick off the flow.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm run lint`
Expected: no errors

Run: `pnpm exec prisma generate`
Expected: succeeds

Run: `pnpm run build`
Expected: succeeds

Run: `pnpm run test`
Expected: all unit tests PASS, and confirm no test file still references `jose`, `SupabaseJwtGuard`, or `SUPABASE_URL`:

Run: `grep -rl "jose\|SupabaseJwtGuard\|SUPABASE_URL\|SUPABASE_JWT_SECRET\|verifyAndSyncUser" src test .github .env.example` — expected: no output (empty).

Run: `pnpm run test:e2e`
Expected: all e2e tests PASS

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git rm scripts/manual-google-login.html
git commit -m "chore: update User doc comment, remove obsolete Supabase login script"
```

---

### Task 9: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the "Current state" paragraph**

In `CLAUDE.md`'s "Current state" section, replace the Phase 2 sentence (the one starting "Phase 2 (dashboard auth) is complete and confirmed end-to-end: `AuthModule` ... Google OAuth is configured in the Supabase dashboard...") with a paragraph describing the new state: `AuthModule` now drives Google OAuth itself via `passport-google-oauth20` (`GET /auth/google` → `GET /auth/google/callback`), `AuthService.findOrCreateUser`/`signToken` replace `verifyAndSyncUser`, and `JwtAuthGuard` (self-issued JWTs via `@nestjs/jwt`, `JWT_SECRET`) replaces `SupabaseJwtGuard` on `GET /me`, `api-keys`, and `usage` routes. Note that Supabase is now database-only (`DATABASE_URL`), and `scripts/manual-google-login.html` was removed since Nest drives the redirect directly.

- [ ] **Step 2: Update the "Prisma / Nest gotchas" section**

Remove or rewrite the bullet about `jose` needing to stay pinned to 4.x (no longer applicable — `jose` is removed). Remove the bullet about Supabase's asymmetric JWT signing / JWKS verification, replacing it with a short note that session JWTs are now self-signed via `@nestjs/jwt` with `JWT_SECRET`, and that `GOOGLE_CALLBACK_URL` must exactly match the redirect URI registered on the Google Cloud OAuth client.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for self-hosted Google OAuth + JWT auth"
```

---

### Task 10: Manual end-to-end verification (requires real Google OAuth credentials — human-in-the-loop)

**Files:** none — this is a verification task, not a code change.

**This task cannot be completed autonomously by an agent.** It requires:
- A real Google Cloud OAuth client (Client ID/Secret) with `http://localhost:3000/auth/google/callback` registered as an authorized redirect URI.
- A real browser session with a real Google account to complete the consent screen.

If you are an agent executing this plan and do not have these, stop here and hand this task back to the user with the steps below rather than attempting to simulate or fake completion.

- [x] **Step 1:** Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `JWT_SECRET`, `FRONTEND_URL` in `.env` with real values (Google Cloud Console for the OAuth client; `FRONTEND_URL` can point anywhere reachable, e.g. `http://localhost:3001`, since no dashboard frontend exists yet — the redirect target just needs to be inspectable).
- [x] **Step 2:** `docker compose up --build`
- [x] **Step 3:** In a browser, visit `http://localhost:3000/auth/google`. Confirm it redirects to Google's consent screen.
- [x] **Step 4:** Complete Google login. Confirm the browser lands on `${FRONTEND_URL}/auth/callback#token=<jwt>` with a real JWT in the URL fragment.
- [x] **Step 5:** Copy that token and confirm `GET /me` (e.g. via curl or Postman) with `Authorization: Bearer <token>` returns the expected user profile, and that a `User` row was created in the real Supabase Postgres DB (check via `pnpm exec prisma studio` or a direct query). Found and fixed a real bug along the way: `AuthService.findOrCreateUser` upserted on `id` (Google's `sub`) instead of `email`, so a pre-existing `User` row from before this migration (same email, old Supabase-issued `id`) missed the lookup and crashed on the `create` branch's `email` unique-constraint collision. Fixed to upsert on `email`; re-verified after the fix.
- [x] **Step 6:** Confirm `GET /me` with no token, or a tampered token, returns 401.
- [x] **Step 7:** Clean up any test data created in the real DB during this verification, the same way prior phases' manual verification steps did.
- [x] **Step 8:** Update `CLAUDE.md`'s "Current state" paragraph (from Task 10) to note this was confirmed end-to-end against real Google OAuth + Supabase Postgres, matching how every prior phase's confirmation was recorded.
