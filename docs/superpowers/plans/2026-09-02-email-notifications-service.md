# Email Notifications Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `POST /api/v1/notifications/email`, Neuron's first Notifications-service route, which queues an email job (BullMQ + the existing Redis) and sends it via Resend asynchronously, completing Phase 5 of the development plan.

**Architecture:** A `NotificationsModule` following the exact `Module + Controller + Service + ApiKeyGuard` shape `ShortUrlModule` already established. The controller queues a BullMQ job and returns `202` immediately; a separate `EmailProcessor` worker consumes the queue and calls Resend, isolated from the request/response cycle so a slow or failing provider never blocks a caller.

**Tech Stack:** NestJS 11, `@nestjs/bullmq` + `bullmq` (job queue, backed by the `redis` service already in `docker-compose.yml`), `resend` (email provider SDK), `class-validator` DTOs, Jest/ts-jest unit + e2e tests (existing conventions).

**Spec:** `docs/superpowers/specs/2026-09-02-email-notifications-design.md`

## Global Constraints

- Pin `@nestjs/bullmq` to `^11.0.5`, not `^12.0.0` — stays on the same major line as every other `@nestjs/*` package in this repo (all pinned to 11.x); 12.x hasn't been vetted against this repo's CommonJS Jest setup.
- Pin `bullmq` to `^5.81.4`, not `^6.x` — bullmq 6.x moved `ioredis`/`redis` to peer dependencies requiring an extra explicit install; 5.x still bundles `ioredis` as a direct dependency, avoiding an unnecessary version decision. Verified via `pnpm info`: 5.81.4 ships both `main` (CJS) and `module` (ESM) builds, safe under ts-jest.
- `resend` (`^6.25.0`) ships both a CJS `main` and ESM `module` build — verified safe under this repo's CommonJS Jest setup, unlike the ESM-only traps already documented in CLAUDE.md (`jose`, `nanoid` 4+, `@nestjs/config` 12.x, `prisma-client`, `@nestjs/jwt`/`@nestjs/passport` 12.x).
- No new Prisma models or migrations — the spec explicitly excludes a `NotificationLog` table; delivery success/failure is fire-and-forget, visible only in structured logs.
- Every `ApiKeyGuard`-protected route stays under `/api/v{n}/...` (`src/common/api-versioning.spec.ts` enforces this) — `POST /api/v1/notifications/email` must follow the convention and that spec's controller list must include the new controller.
- `ShortUrlModule` must remain the **last** import in `AppModule` (its `GET /:code` catch-all route would otherwise shadow later routes). `NotificationsModule` must be added **before** it.
- Every method in a `*.service.ts` file needs the JSDoc block described in CLAUDE.md's Code conventions section (summary, `@throws`-equivalent line per exception, `@param`/`@returns`).
- `EmailProcessor.process()` must **rethrow** on a Resend failure (not swallow it) — that's what lets BullMQ's own `attempts`/`backoff` job options retry it. This is a different mechanism from this repo's existing fire-and-forget Prisma writes (`.catch(() => {})`); don't conflate the two.
- Retry policy is fixed: `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }`, set on the job in `NotificationsService.queueEmail`, not on the processor.
- Throttle: `@Throttle({ default: { limit: 10, ttl: 60_000 } })` on `POST /api/v1/notifications/email`, matching `POST /shorten`.

---

## Task 1: Dependencies and environment configuration

**Files:**
- Modify: `package.json`
- Modify: `src/config/env.validation.ts`
- Modify: `src/config/env.validation.spec.ts`
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: four new required env vars validated at startup — `REDIS_HOST: string`, `REDIS_PORT: number`, `RESEND_API_KEY: string`, `RESEND_FROM_EMAIL: string` (well-formed email). Later tasks read these via `configService.getOrThrow<T>(...)`.

- [ ] **Step 1: Add the new dependencies**

Run:
```bash
pnpm add @nestjs/bullmq@^11.0.5 bullmq@^5.81.4 resend@^6.25.0
```

- [ ] **Step 2: Add the new env vars to `EnvironmentVariables` in `src/config/env.validation.ts`**

Add `IsEmail` to the existing `class-validator` import list at the top of the file (alongside `IsInt`, `IsOptional`, `IsString`, `IsUrl`, `Min`, `validateSync`), then add these fields to the `EnvironmentVariables` class, after the existing `PORT` field:

```typescript
  @IsString()
  REDIS_HOST: string;

  @IsInt()
  @Min(1)
  REDIS_PORT: number;

  @IsString()
  RESEND_API_KEY: string;

  @IsEmail()
  RESEND_FROM_EMAIL: string;
```

- [ ] **Step 3: Write failing tests for the new validation in `src/config/env.validation.spec.ts`**

Add these four keys to the `validEnv` object at the top of the file:

```typescript
  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
    JWT_SECRET: 'test-jwt-secret',
    FRONTEND_URL: 'http://localhost:3001',
    PORT: '3000',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    RESEND_API_KEY: 'test-resend-api-key',
    RESEND_FROM_EMAIL: 'notifications@neuron.test',
  };
```

Then add these test cases (place them near the end of the file, alongside the other `throws when ... is missing/malformed` tests):

```typescript
  it('returns validated REDIS_HOST/REDIS_PORT/RESEND_API_KEY/RESEND_FROM_EMAIL', () => {
    const result = validate(validEnv);

    expect(result.REDIS_HOST).toBe('localhost');
    expect(result.REDIS_PORT).toBe(6379);
    expect(result.RESEND_API_KEY).toBe('test-resend-api-key');
    expect(result.RESEND_FROM_EMAIL).toBe('notifications@neuron.test');
  });

  it('throws when REDIS_HOST is missing', () => {
    const { REDIS_HOST: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/REDIS_HOST/);
  });

  it('throws when REDIS_PORT is missing', () => {
    const { REDIS_PORT: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/REDIS_PORT/);
  });

  it('throws when RESEND_API_KEY is missing', () => {
    const { RESEND_API_KEY: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/RESEND_API_KEY/);
  });

  it('throws when RESEND_FROM_EMAIL is not a valid email', () => {
    expect(() =>
      validate({ ...validEnv, RESEND_FROM_EMAIL: 'not-an-email' }),
    ).toThrow(/RESEND_FROM_EMAIL/);
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm run test -- env.validation`
Expected: PASS (this file has no code-under-test bug to reproduce first — Steps 2 and 3 together implement the feature the test checks; this step confirms both landed correctly).

- [ ] **Step 5: Add the new vars to `.env.example`**

Add this block after the existing `DATABASE_URL` section:

```
# Redis (BullMQ job queue) — matches docker-compose.yml's `redis` service
REDIS_HOST="redis"
REDIS_PORT=6379

# Resend (email notifications) — https://resend.com/api-keys
RESEND_API_KEY="your-resend-api-key"
RESEND_FROM_EMAIL="notifications@yourdomain.com"
```

- [ ] **Step 6: Add the new vars to the CI job's env block in `.github/workflows/ci.yml`**

In the `lint-and-build` job's `env:` block, add after `FRONTEND_URL`:

```yaml
      REDIS_HOST: localhost
      REDIS_PORT: '6379'
      RESEND_API_KEY: ci-placeholder-resend-key
      RESEND_FROM_EMAIL: notifications@neuron-ci.test
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/config/env.validation.ts src/config/env.validation.spec.ts .env.example .github/workflows/ci.yml
git commit -m "feat: add BullMQ/Resend dependencies and required env vars"
```

---

## Task 2: Resend client provider, email DTO, and EmailProcessor

**Files:**
- Create: `src/notifications/resend-client.provider.ts`
- Create: `src/notifications/dto/create-email.dto.ts`
- Create: `src/notifications/email.processor.ts`
- Test: `src/notifications/email.processor.spec.ts`

**Interfaces:**
- Consumes: `ConfigService.getOrThrow<T>(key)` (existing pattern, e.g. `src/auth/strategies/google.strategy.ts`).
- Produces:
  - `RESEND_CLIENT` — injection token (string constant), exported from `resend-client.provider.ts`, provides a `Resend` instance.
  - `CreateEmailDto` — `{ to: string[]; subject: string; body: string }`, used by Task 3 (`NotificationsService.queueEmail`) and Task 4 (`NotificationsController.send`).
  - `EmailProcessor` — class with `process(job: Job<CreateEmailDto>): Promise<void>`, registered as a provider in Task 4's `NotificationsModule`.

- [ ] **Step 1: Create the Resend client provider**

`src/notifications/resend-client.provider.ts`:
```typescript
import { ConfigService } from '@nestjs/config';
import { Provider } from '@nestjs/common';
import { Resend } from 'resend';

export const RESEND_CLIENT = 'RESEND_CLIENT';

export const resendClientProvider: Provider = {
  provide: RESEND_CLIENT,
  useFactory: (configService: ConfigService) =>
    new Resend(configService.getOrThrow<string>('RESEND_API_KEY')),
  inject: [ConfigService],
};
```

- [ ] **Step 2: Create the email DTO**

`src/notifications/dto/create-email.dto.ts`:
```typescript
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class CreateEmailDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  to: string[];

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  body: string;
}
```

- [ ] **Step 3: Write the failing test for `EmailProcessor`**

`src/notifications/email.processor.spec.ts`:
```typescript
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { EmailProcessor } from './email.processor';
import { RESEND_CLIENT } from './resend-client.provider';
import { CreateEmailDto } from './dto/create-email.dto';

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let resend: { emails: { send: jest.Mock } };

  beforeEach(async () => {
    resend = { emails: { send: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProcessor,
        { provide: RESEND_CLIENT, useValue: resend },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'notifications@neuron.test' },
        },
      ],
    }).compile();

    processor = module.get(EmailProcessor);
  });

  it('sends the email via Resend with the job payload', async () => {
    resend.emails.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const job = {
      id: 'job-1',
      data: {
        to: ['recipient@example.com'],
        subject: 'Hi',
        body: '<p>Hello</p>',
      },
    } as Job<CreateEmailDto>;

    await processor.process(job);

    expect(resend.emails.send).toHaveBeenCalledWith({
      from: 'notifications@neuron.test',
      to: ['recipient@example.com'],
      subject: 'Hi',
      html: '<p>Hello</p>',
    });
  });

  it('rethrows when Resend fails, so BullMQ retries the job', async () => {
    resend.emails.send.mockRejectedValue(new Error('resend is down'));
    const job = {
      id: 'job-2',
      data: {
        to: ['recipient@example.com'],
        subject: 'Hi',
        body: '<p>Hello</p>',
      },
    } as Job<CreateEmailDto>;

    await expect(processor.process(job)).rejects.toThrow('resend is down');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm run test -- email.processor`
Expected: FAIL with "Cannot find module './email.processor'"

- [ ] **Step 5: Implement `EmailProcessor`**

`src/notifications/email.processor.ts`:
```typescript
import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import type { Resend } from 'resend';
import { RESEND_CLIENT } from './resend-client.provider';
import { CreateEmailDto } from './dto/create-email.dto';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly fromEmail: string;

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend,
    configService: ConfigService,
  ) {
    super();
    this.fromEmail = configService.getOrThrow<string>('RESEND_FROM_EMAIL');
  }

  /**
   * Sends one queued email job via Resend.
   * Rethrows any Resend failure so BullMQ's configured attempts/backoff on
   * the job retries it — this method must never swallow an error itself.
   *
   * @param job - BullMQ job carrying the validated email payload
   */
  async process(job: Job<CreateEmailDto>): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: job.data.to,
        subject: job.data.subject,
        html: job.data.body,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email for job ${job.id}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm run test -- email.processor`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/notifications/resend-client.provider.ts src/notifications/dto/create-email.dto.ts src/notifications/email.processor.ts src/notifications/email.processor.spec.ts
git commit -m "feat: add Resend client provider, email DTO, and EmailProcessor"
```

---

## Task 3: NotificationsService (queue producer)

**Files:**
- Create: `src/notifications/notifications.service.ts`
- Test: `src/notifications/notifications.service.spec.ts`

**Interfaces:**
- Consumes: `CreateEmailDto` (Task 2), `@InjectQueue`/`getQueueToken` from `@nestjs/bullmq`.
- Produces: `NotificationsService.queueEmail(dto: CreateEmailDto): Promise<void>`, used by Task 4's `NotificationsController.send`.

- [ ] **Step 1: Write the failing test**

`src/notifications/notifications.service.spec.ts`:
```typescript
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { CreateEmailDto } from './dto/create-email.dto';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getQueueToken('email'), useValue: queue },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  it('queues an email job with the fixed retry/backoff policy', async () => {
    queue.add.mockResolvedValue({});
    const dto: CreateEmailDto = {
      to: ['recipient@example.com'],
      subject: 'Hi',
      body: '<p>Hello</p>',
    };

    await service.queueEmail(dto);

    expect(queue.add).toHaveBeenCalledWith('send', dto, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- notifications.service`
Expected: FAIL with "Cannot find module './notifications.service'"

- [ ] **Step 3: Implement `NotificationsService`**

`src/notifications/notifications.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateEmailDto } from './dto/create-email.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue<CreateEmailDto>,
  ) {}

  /**
   * Queues a validated email payload for asynchronous delivery.
   * Only throws if the queue itself can't accept the job (e.g. Redis is
   * unreachable) — that propagates as a 500 via GlobalExceptionFilter.
   * A downstream Resend failure is EmailProcessor's concern, handled via
   * BullMQ's own retry/backoff on the job, not by this method.
   *
   * @param dto - Validated recipients/subject/body payload
   */
  async queueEmail(dto: CreateEmailDto): Promise<void> {
    await this.emailQueue.add('send', dto, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- notifications.service`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/notifications/notifications.service.ts src/notifications/notifications.service.spec.ts
git commit -m "feat: add NotificationsService email queue producer"
```

---

## Task 4: NotificationsController, NotificationsModule, and AppModule wiring

**Files:**
- Create: `src/notifications/notifications.controller.ts`
- Create: `src/notifications/notifications.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/common/api-versioning.spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.queueEmail` (Task 3), `EmailProcessor` (Task 2), `resendClientProvider`/`RESEND_CLIENT` (Task 2), `ApiKeyGuard`/`UsageLoggingInterceptor`/`Service` decorator (existing).
- Produces: `POST /api/v1/notifications/email` route, `NotificationsModule` (importable/testable as a unit in Task 5's e2e test).

- [ ] **Step 1: Create `NotificationsController`**

`src/notifications/notifications.controller.ts`:
```typescript
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { Service } from '../usage/decorators/service.decorator';
import { UsageLoggingInterceptor } from '../usage/interceptors/usage-logging.interceptor';
import { NotificationsService } from './notifications.service';
import { CreateEmailDto } from './dto/create-email.dto';

@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('api/v1/notifications/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async send(@Body() dto: CreateEmailDto): Promise<{ queued: true }> {
    await this.notificationsService.queueEmail(dto);
    return { queued: true };
  }
}
```

- [ ] **Step 2: Create `NotificationsModule`**

`src/notifications/notifications.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsageModule } from '../usage/usage.module';
import { ApiKeyModule } from '../api-keys/api-keys.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailProcessor } from './email.processor';
import { resendClientProvider } from './resend-client.provider';

@Module({
  // ApiKeyModule/UsageModule are imported explicitly for
  // ApiKeyGuard/UsageLoggingInterceptor, matching ShortUrlModule's
  // convention — Nest would resolve them globally regardless, but the
  // import documents the real dependency.
  imports: [
    UsageModule,
    ApiKeyModule,
    BullModule.registerQueue({ name: 'email' }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailProcessor, resendClientProvider],
})
export class NotificationsModule {}
```

- [ ] **Step 3: Wire `BullModule.forRootAsync` and `NotificationsModule` into `AppModule`**

In `src/app.module.ts`, add imports for `BullModule` and `NotificationsModule`:

```typescript
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsModule } from './notifications/notifications.module';
```

(Note: `ConfigService` needs adding to the existing `@nestjs/config` import, which currently only imports `ConfigModule`.)

Then update the `imports` array — add `BullModule.forRootAsync` after `PrismaModule` and add `NotificationsModule` right before `ShortUrlModule`:

```typescript
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 20 }],
    }),
    PrismaModule,
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
        },
      }),
      inject: [ConfigService],
    }),
    HealthModule,
    AuthModule,
    ApiKeyModule,
    UsageModule,
    NotificationsModule,
    // Must stay last: ShortUrlController's GET /:code is a catch-all
    // single-segment route, and Nest/Express match routes in registration
    // order rather than by specificity.
    ShortUrlModule,
  ],
```

- [ ] **Step 4: Add `NotificationsController` to the versioning regression test**

In `src/common/api-versioning.spec.ts`, add the import:

```typescript
import { NotificationsController } from '../notifications/notifications.controller';
```

And add it to the `ALL_CONTROLLERS` array:

```typescript
const ALL_CONTROLLERS = [
  AppController,
  HealthController,
  AuthController,
  ApiKeyController,
  UsageController,
  ShortUrlController,
  NotificationsController,
];
```

- [ ] **Step 5: Run the full unit test suite and build**

Run:
```bash
pnpm run test
pnpm run build
```
Expected: all tests PASS (including `api-versioning.spec.ts`, which now sees `POST /api/v1/notifications/email` as an `ApiKeyGuard` route already versioned correctly), build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/notifications/notifications.controller.ts src/notifications/notifications.module.ts src/app.module.ts src/common/api-versioning.spec.ts
git commit -m "feat: wire NotificationsModule into AppModule with BullMQ root config"
```

---

## Task 5: End-to-end test

**Files:**
- Create: `test/notifications.e2e-spec.ts`

**Interfaces:**
- Consumes: `AppModule`, `PrismaService`, `getQueueToken('email')` (Task 4's `NotificationsModule`), `EmailProcessor` (Task 2) — all overridden with mocks so the e2e run never opens a real Postgres or Redis connection, matching this repo's existing e2e philosophy (see `test/short-url.e2e-spec.ts`).

- [ ] **Step 1: Write the e2e test**

`test/notifications.e2e-spec.ts`:
```typescript
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { EmailProcessor } from './../src/notifications/email.processor';

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  const prismaMock = {
    apiKey: { findFirst: jest.fn(), update: jest.fn() },
    usageLog: { create: jest.fn() },
  };
  const emailQueueMock = { add: jest.fn() };

  beforeEach(async () => {
    prismaMock.apiKey.update.mockResolvedValue({});
    prismaMock.usageLog.create.mockResolvedValue({});
    emailQueueMock.add.mockResolvedValue({});

    // Overriding the 'email' queue token and EmailProcessor entirely
    // (not just their outputs) prevents Nest from ever constructing the
    // real BullMQ Queue/Worker — so this suite never opens a real Redis
    // connection, the same mocking philosophy this repo already applies
    // to PrismaService.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(getQueueToken('email'))
      .useValue(emailQueueMock)
      .overrideProvider(EmailProcessor)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('queues an email for an authenticated caller and logs usage under email-notifications', async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      revokedAt: null,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/notifications/email')
      .set('x-api-key', 'nrn_validkeymaterial')
      .send({
        to: ['recipient@example.com'],
        subject: 'Test',
        body: '<p>Hello</p>',
      })
      .expect(202);

    expect(response.body).toEqual({ queued: true });
    expect(emailQueueMock.add).toHaveBeenCalledWith(
      'send',
      { to: ['recipient@example.com'], subject: 'Test', body: '<p>Hello</p>' },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
    expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'key-1',
        service: 'email-notifications',
        endpoint: '/api/v1/notifications/email',
      },
    });
  });

  it('rejects POST /api/v1/notifications/email with no x-api-key header', () => {
    return request(app.getHttpServer())
      .post('/api/v1/notifications/email')
      .send({
        to: ['recipient@example.com'],
        subject: 'Test',
        body: '<p>Hello</p>',
      })
      .expect(401);
  });

  it('rejects an invalid payload with 400 and never queues the job', async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      revokedAt: null,
    });

    await request(app.getHttpServer())
      .post('/api/v1/notifications/email')
      .set('x-api-key', 'nrn_validkeymaterial')
      .send({ to: ['not-an-email'], subject: '', body: '' })
      .expect(400);

    expect(emailQueueMock.add).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm run test:e2e -- notifications.e2e-spec.ts`
Expected: all 3 tests PASS.

- [ ] **Step 3: Run the full e2e suite to confirm no regressions**

Run: `pnpm run test:e2e`
Expected: all suites PASS, including `test/short-url.e2e-spec.ts`'s existing check that `GET /health` still resolves correctly with every service module wired in.

- [ ] **Step 4: Commit**

```bash
git add test/notifications.e2e-spec.ts
git commit -m "test: add e2e coverage for POST /api/v1/notifications/email"
```

---

## Task 6: Manual verification, docs, and final check

**Files:**
- Modify: `docs/development-plan.md`
- Modify: `CLAUDE.md`

**Interfaces:** None — this task verifies the running system and updates project docs; it doesn't change application code.

- [ ] **Step 1: Verify a real Resend account/API key and a real inbox are available**

Confirm `RESEND_API_KEY` (a real key from https://resend.com/api-keys) and `RESEND_FROM_EMAIL` (a verified sending address/domain on that Resend account) are set in the real `.env` file — not the CI placeholders from Task 1. If Resend requires domain verification and none is set up yet, use Resend's sandbox/test-mode sending address for this check instead, and note that in the CLAUDE.md update in Step 4.

- [ ] **Step 2: Run the full stack via Docker Compose**

Run: `docker compose up --build`
Expected: `app`, `redis`, and `frontend` all start; `app`'s healthcheck passes (matches this project's standing preference for Docker-based verification over bare `pnpm run start:dev`).

- [ ] **Step 3: Send a real email end-to-end**

Using a seeded API key (`pnpm exec prisma db seed` if not already seeded), send:
```bash
curl -i -X POST http://localhost:3000/api/v1/notifications/email \
  -H "x-api-key: <seeded raw key>" \
  -H "Content-Type: application/json" \
  -d '{"to":["<a real inbox you control>"],"subject":"Neuron test","body":"<p>Hello from Neuron</p>"}'
```
Expected: `202 { "queued": true }` returned immediately; the email arrives in the target inbox shortly after (check `docker compose logs app` for the `EmailProcessor` send confirmation). Also confirm `GET /usage` (with a dashboard JWT) shows a `email-notifications` entry, and that an invalid payload (e.g. missing `subject`) returns `400`.

- [ ] **Step 4: Update `docs/development-plan.md`'s Phase 5 checkboxes**

Check off the completed items under `## Phase 5 — Notifications Service (Email)`:
```markdown
- [x] Pick an email provider (Resend, Postmark, or SES — decide when you get here)
- [x] `NotificationsModule` with `POST /notifications/email` (`to`, `subject`, `body`/`template`)
- [x] Input validation via DTOs + `class-validator`
- [x] Queue-based sending (BullMQ + Redis, or Supabase-based queue) so requests return fast and retries are handled
- [x] Error handling: provider failure shouldn't crash the request — log + retry
- [x] Protect route with `ApiKeyGuard`
```

- [ ] **Step 5: Append a paragraph to CLAUDE.md's "Current state" section**

Following the existing narrative style (see how the URL Shortener phase and the two hardening passes are described), add a paragraph after the current final paragraph summarizing: `NotificationsModule` built (`POST /api/v1/notifications/email`, BullMQ + Redis-backed queue, Resend for delivery, fire-and-forget/no status endpoint per the design spec), the new `EmailProcessor` worker and its retry/backoff policy, the new required env vars, and the specific outcome of the Step 3 manual verification (what was actually confirmed — real email delivered, usage logged, invalid payload rejected — and whether Resend sandbox mode was used per Step 1).

- [ ] **Step 6: Commit the docs updates**

```bash
git add docs/development-plan.md CLAUDE.md
git commit -m "docs: mark Phase 5 (email notifications) complete"
```
