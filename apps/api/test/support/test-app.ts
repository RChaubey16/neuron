import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { EMAIL_QUEUE, type SendEmailJobData } from '@neuron/core';
import type { User } from '@neuron/db';
import type { Queue } from 'bullmq';
import { vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import type {
  GoogleAuthorizationRequest,
  GoogleProfile,
} from '../../src/auth/google-oauth.service.js';
import { GoogleOAuthService } from '../../src/auth/google-oauth.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TEST_ALLOWED_EMAIL } from './test-env.mjs';

export const FAKE_GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?fake=1';
export const FAKE_STATE = 'fake-state-value';
export const FAKE_CODE_VERIFIER = 'fake-code-verifier';

/** Stands in for Google: the tests decide what profile (or error) comes back. */
export class FakeGoogleOAuthService {
  createAuthorizationRequest = vi.fn((): Promise<GoogleAuthorizationRequest> =>
    Promise.resolve({ url: FAKE_GOOGLE_URL, state: FAKE_STATE, codeVerifier: FAKE_CODE_VERIFIER }),
  );

  getProfile = vi.fn((_code: string, _codeVerifier: string): Promise<GoogleProfile> =>
    Promise.resolve(googleProfile()),
  );
}

export function googleProfile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    googleId: 'google-user-1',
    email: TEST_ALLOWED_EMAIL,
    emailVerified: true,
    name: 'Test User',
    avatarUrl: 'https://example.com/avatar.png',
    ...overrides,
  };
}

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  google: FakeGoogleOAuthService;
  auth: AuthService;
  emailQueue: Queue<SendEmailJobData>;
}

export async function createTestApp(): Promise<TestApp> {
  const google = new FakeGoogleOAuthService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleOAuthService)
    .useValue(google)
    .compile();

  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    google,
    auth: app.get(AuthService),
    emailQueue: app.get<Queue<SendEmailJobData>>(getQueueToken(EMAIL_QUEUE)),
  };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "messages", "api_keys", "users" CASCADE');
}

/** Removes every job from the queue (in the test Redis database). */
export async function resetQueue(queue: Queue): Promise<void> {
  await queue.obliterate({ force: true });
}

let userCounter = 0;

export async function createUser(
  prisma: PrismaService,
  overrides: Partial<Pick<User, 'email' | 'googleId'>> = {},
): Promise<User> {
  userCounter += 1;
  return prisma.user.create({
    data: {
      googleId: overrides.googleId ?? `google-${userCounter}`,
      email: overrides.email ?? TEST_ALLOWED_EMAIL,
      name: 'Test User',
    },
  });
}

/** A Cookie header value for a signed-in session as this user. */
export async function sessionCookie(auth: AuthService, user: Pick<User, 'id'>): Promise<string> {
  return `${SESSION_COOKIE}=${await auth.createSessionToken(user)}`;
}

/** Set-Cookie headers from a supertest response, always as an array. */
export function setCookies(headers: Record<string, unknown>): string[] {
  const value = headers['set-cookie'];
  if (Array.isArray(value)) return value.map(String);
  return typeof value === 'string' ? [value] : [];
}
