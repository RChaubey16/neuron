import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleOAuthError } from '../src/auth/google-oauth.service.js';
import {
  createTestApp,
  createUser,
  FAKE_CODE_VERIFIER,
  FAKE_GOOGLE_URL,
  FAKE_STATE,
  googleProfile,
  resetDatabase,
  sessionCookie,
  setCookies,
  type TestApp,
} from './support/test-app.js';
import { TEST_ALLOWED_EMAIL, TEST_SESSION_SECRET, TEST_WEB_URL } from './support/test-env.mjs';

function findCookie(cookies: string[], name: string): string | undefined {
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

/** The `name=value` part of a Set-Cookie header, ready for a Cookie header. */
function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0] ?? '';
}

function errorRedirect(code: string): string {
  return `${TEST_WEB_URL}/sign-in?error=${code}`;
}

describe('Google sign-in (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.google.getProfile.mockReset();
    t.google.getProfile.mockResolvedValue(googleProfile());
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await t.app.close();
  });

  /** Starts sign-in and returns the OAuth cookie, as the browser would keep it. */
  async function startSignIn(): Promise<string> {
    const response = await request(t.app.getHttpServer()).get('/auth/google').expect(302);
    const cookie = findCookie(setCookies(response.headers), 'neuron_oauth');
    if (!cookie) throw new Error('No neuron_oauth cookie was set');
    return cookiePair(cookie);
  }

  function callback(query: Record<string, string>, cookie?: string) {
    const req = request(t.app.getHttpServer()).get('/auth/google/callback').query(query);
    return cookie ? req.set('Cookie', cookie) : req;
  }

  describe('GET /auth/google', () => {
    it('redirects to Google and stores the state in a signed, HttpOnly cookie', async () => {
      const response = await request(t.app.getHttpServer()).get('/auth/google').expect(302);

      expect(response.headers['location']).toBe(FAKE_GOOGLE_URL);
      const cookie = findCookie(setCookies(response.headers), 'neuron_oauth');
      expect(cookie).toBeDefined();
      // Signed by cookie-parser: the value starts with "s:" (URL-encoded).
      expect(cookie).toMatch(/^neuron_oauth=s%3A/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Path=\/auth\/google/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Max-Age=600/);
    });
  });

  describe('GET /auth/google/callback', () => {
    it('signs in an allowed user: creates them, sets the session and redirects to the dashboard', async () => {
      const cookie = await startSignIn();

      const response = await callback({ code: 'auth-code', state: FAKE_STATE }, cookie).expect(302);

      expect(response.headers['location']).toBe(`${TEST_WEB_URL}/`);
      expect(t.google.getProfile).toHaveBeenCalledWith('auth-code', FAKE_CODE_VERIFIER);

      const cookies = setCookies(response.headers);
      const session = findCookie(cookies, 'neuron_session');
      expect(session).toMatch(/HttpOnly/);
      expect(session).toMatch(/SameSite=Lax/);
      expect(session).toMatch(/Path=\//);
      expect(session).toMatch(/Max-Age=604800/);
      // The one-time OAuth cookie is cleared.
      expect(findCookie(cookies, 'neuron_oauth')).toMatch(/Expires=Thu, 01 Jan 1970/);

      const users = await t.prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({
        googleId: 'google-user-1',
        email: TEST_ALLOWED_EMAIL,
        name: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
      });

      // The new session works.
      const me = await request(t.app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookiePair(session ?? ''))
        .expect(200);
      expect(me.body).toEqual({
        id: users[0]?.id,
        email: TEST_ALLOWED_EMAIL,
        name: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
      });
    });

    it('updates the same user on a later sign-in', async () => {
      await callback({ code: 'one', state: FAKE_STATE }, await startSignIn()).expect(302);
      const first = await t.prisma.user.findFirstOrThrow();

      t.google.getProfile.mockResolvedValue(googleProfile({ name: 'New Name', avatarUrl: null }));
      await callback({ code: 'two', state: FAKE_STATE }, await startSignIn()).expect(302);

      const users = await t.prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]?.id).toBe(first.id);
      expect(users[0]?.name).toBe('New Name');
      expect(users[0]?.avatarUrl).toBeNull();
      expect(users[0]?.lastLoginAt.getTime()).toBeGreaterThanOrEqual(first.lastLoginAt.getTime());
    });

    it('refuses an email that is not in ALLOWED_EMAILS', async () => {
      t.google.getProfile.mockResolvedValue(googleProfile({ email: 'stranger@example.com' }));

      const response = await callback({ code: 'c', state: FAKE_STATE }, await startSignIn());

      expect(response.headers['location']).toBe(errorRedirect('not_allowed'));
      expect(findCookie(setCookies(response.headers), 'neuron_session')).toBeUndefined();
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('refuses an unverified Google email', async () => {
      t.google.getProfile.mockResolvedValue(googleProfile({ emailVerified: false }));

      const response = await callback({ code: 'c', state: FAKE_STATE }, await startSignIn());

      expect(response.headers['location']).toBe(errorRedirect('email_not_verified'));
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('rejects a state that does not match the cookie', async () => {
      const response = await callback({ code: 'c', state: 'other-state' }, await startSignIn());

      expect(response.headers['location']).toBe(errorRedirect('invalid_state'));
      expect(t.google.getProfile).not.toHaveBeenCalled();
    });

    it('rejects a callback without the OAuth cookie', async () => {
      const response = await callback({ code: 'c', state: FAKE_STATE });

      expect(response.headers['location']).toBe(errorRedirect('invalid_state'));
      expect(t.google.getProfile).not.toHaveBeenCalled();
    });

    it('rejects a tampered OAuth cookie', async () => {
      const forged = `neuron_oauth=${encodeURIComponent(
        `s:${JSON.stringify({ state: FAKE_STATE, codeVerifier: 'x' })}.forged-signature`,
      )}`;

      const response = await callback({ code: 'c', state: FAKE_STATE }, forged);

      expect(response.headers['location']).toBe(errorRedirect('invalid_state'));
      expect(t.google.getProfile).not.toHaveBeenCalled();
    });

    it('rejects a callback without a code', async () => {
      const response = await callback({ state: FAKE_STATE }, await startSignIn());

      expect(response.headers['location']).toBe(errorRedirect('invalid_request'));
    });

    it('passes on a user cancelling at Google', async () => {
      const response = await callback({ error: 'access_denied' }, await startSignIn());

      expect(response.headers['location']).toBe(errorRedirect('access_denied'));
    });

    it('reports other Google errors as google_error', async () => {
      const response = await callback({ error: 'server_error' }, await startSignIn());

      expect(response.headers['location']).toBe(errorRedirect('google_error'));
    });

    it('reports a failed code exchange as google_error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      t.google.getProfile.mockRejectedValue(new GoogleOAuthError('invalid_grant'));

      const response = await callback({ code: 'c', state: FAKE_STATE }, await startSignIn());

      expect(response.headers['location']).toBe(errorRedirect('google_error'));
      expect(await t.prisma.user.count()).toBe(0);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 without a session', async () => {
      await request(t.app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('returns 401 for a malformed session token', async () => {
      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', 'neuron_session=not-a-jwt')
        .expect(401);
    });

    it('returns 401 for a session signed with another secret', async () => {
      const user = await createUser(t.prisma);
      const token = new JwtService({ secret: 'some-other-secret-that-is-long-enough' }).sign({
        sub: user.id,
      });

      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', `neuron_session=${token}`)
        .expect(401);
    });

    it('returns 401 for an expired session', async () => {
      const user = await createUser(t.prisma);
      const token = new JwtService({ secret: TEST_SESSION_SECRET }).sign(
        { sub: user.id },
        { expiresIn: -10 },
      );

      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', `neuron_session=${token}`)
        .expect(401);
    });

    it('returns 401 once the user is removed from ALLOWED_EMAILS', async () => {
      const user = await createUser(t.prisma, { email: 'removed@example.com' });

      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', await sessionCookie(t.auth, user))
        .expect(401);
    });

    it('returns 401 for a user that no longer exists', async () => {
      const user = await createUser(t.prisma);
      const cookie = await sessionCookie(t.auth, user);
      await t.prisma.user.delete({ where: { id: user.id } });

      await request(t.app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the session cookie', async () => {
      const user = await createUser(t.prisma);

      const response = await request(t.app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', await sessionCookie(t.auth, user))
        .expect(204);

      expect(findCookie(setCookies(response.headers), 'neuron_session')).toMatch(
        /Expires=Thu, 01 Jan 1970/,
      );
    });

    it('succeeds without a session', async () => {
      await request(t.app.getHttpServer()).post('/auth/logout').expect(204);
    });
  });
});
