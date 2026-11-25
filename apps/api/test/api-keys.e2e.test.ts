import type { User } from '@neuron/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey, isWellFormedApiKey } from '../src/api-keys/api-key.js';
import { MAX_ACTIVE_API_KEYS } from '../src/api-keys/api-keys.service.js';
import {
  createTestApp,
  createUser,
  resetDatabase,
  sessionCookie,
  type TestApp,
} from './support/test-app.js';

interface ApiKeyBody {
  id: string;
  name: string;
  prefix: string;
  key?: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

describe('API keys (e2e)', () => {
  let t: TestApp;
  let user: User;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    user = await createUser(t.prisma);
    cookie = await sessionCookie(t.auth, user);
  });

  afterAll(async () => {
    await t.app.close();
  });

  const server = () => t.app.getHttpServer();

  async function createKey(name = 'production', as = cookie): Promise<ApiKeyBody> {
    const response = await request(server())
      .post('/api-keys')
      .set('Cookie', as)
      .send({ name })
      .expect(201);
    return response.body as ApiKeyBody;
  }

  describe('dashboard endpoints need a session', () => {
    it.each([
      ['post', '/api-keys'],
      ['get', '/api-keys'],
      ['delete', '/api-keys/0190f6a0-0000-7000-8000-000000000000'],
    ] as const)('%s %s returns 401 without one', async (method, path) => {
      await request(server())[method](path).expect(401);
    });

    it('does not accept an API key instead of a session', async () => {
      const { key } = await createKey();

      await request(server()).get('/api-keys').set('Authorization', `Bearer ${key}`).expect(401);
    });
  });

  describe('POST /api-keys', () => {
    it('creates a key and returns the full key once', async () => {
      const body = await createKey('  production  ');

      expect(body.name).toBe('production');
      expect(isWellFormedApiKey(body.key ?? '')).toBe(true);
      expect(body.prefix).toBe(body.key?.slice(0, 12));
      expect(body.lastUsedAt).toBeNull();
      expect(body.revokedAt).toBeNull();
    });

    it('stores only the hash of the key', async () => {
      const body = await createKey();

      const stored = await t.prisma.apiKey.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.keyHash).toBe(hashApiKey(body.key ?? ''));
      expect(stored.userId).toBe(user.id);
      expect(JSON.stringify(stored)).not.toContain(body.key);
    });

    it.each([
      ['a missing name', {}],
      ['an empty name', { name: '' }],
      ['a blank name', { name: '   ' }],
      ['a name over 64 characters', { name: 'x'.repeat(65) }],
      ['a non-string name', { name: 42 }],
      ['an unknown field', { name: 'ok', scope: 'admin' }],
    ])('rejects %s with 400', async (_label, body) => {
      await request(server()).post('/api-keys').set('Cookie', cookie).send(body).expect(400);
      expect(await t.prisma.apiKey.count()).toBe(0);
    });

    it(`allows at most ${MAX_ACTIVE_API_KEYS} active keys`, async () => {
      await t.prisma.apiKey.createMany({
        data: Array.from({ length: MAX_ACTIVE_API_KEYS }, (_, i) => {
          const { prefix, hash } = generateApiKey();
          return { userId: user.id, name: `key ${i}`, prefix, keyHash: hash };
        }),
      });

      const refused = await request(server())
        .post('/api-keys')
        .set('Cookie', cookie)
        .send({ name: 'one too many' })
        .expect(409);
      expect((refused.body as { message: string }).message).toMatch(/at most 25/);

      // Revoked keys don't count towards the limit.
      const oldest = await t.prisma.apiKey.findFirstOrThrow();
      await request(server()).delete(`/api-keys/${oldest.id}`).set('Cookie', cookie).expect(204);
      await createKey('replacement');
    });
  });

  describe('GET /api-keys', () => {
    it("lists the user's keys newest first, without the secret, including revoked ones", async () => {
      const first = await createKey('first');
      const second = await createKey('second');
      await request(server()).delete(`/api-keys/${first.id}`).set('Cookie', cookie).expect(204);

      const response = await request(server()).get('/api-keys').set('Cookie', cookie).expect(200);
      const keys = response.body as ApiKeyBody[];

      expect(keys.map((k) => k.name)).toEqual(['second', 'first']);
      expect(keys[0]).toEqual({
        id: second.id,
        name: 'second',
        prefix: second.prefix,
        createdAt: second.createdAt,
        lastUsedAt: null,
        revokedAt: null,
      });
      expect(keys[1]?.revokedAt).not.toBeNull();
      expect(keys.every((k) => k.key === undefined)).toBe(true);
    });

    it("does not show other users' keys", async () => {
      const other = await createUser(t.prisma, { email: 'second@example.com' });
      await createKey('theirs', await sessionCookie(t.auth, other));
      await createKey('mine');

      const response = await request(server()).get('/api-keys').set('Cookie', cookie).expect(200);

      expect((response.body as ApiKeyBody[]).map((k) => k.name)).toEqual(['mine']);
    });
  });

  describe('DELETE /api-keys/:id', () => {
    it('revokes the key, and revoking again still succeeds', async () => {
      const { id } = await createKey();

      await request(server()).delete(`/api-keys/${id}`).set('Cookie', cookie).expect(204);
      const revoked = await t.prisma.apiKey.findUniqueOrThrow({ where: { id } });
      expect(revoked.revokedAt).toBeInstanceOf(Date);

      await request(server()).delete(`/api-keys/${id}`).set('Cookie', cookie).expect(204);
      const again = await t.prisma.apiKey.findUniqueOrThrow({ where: { id } });
      expect(again.revokedAt).toEqual(revoked.revokedAt);
    });

    it("returns 404 for another user's key and leaves it active", async () => {
      const other = await createUser(t.prisma, { email: 'second@example.com' });
      const theirs = await createKey('theirs', await sessionCookie(t.auth, other));

      await request(server()).delete(`/api-keys/${theirs.id}`).set('Cookie', cookie).expect(404);

      const stored = await t.prisma.apiKey.findUniqueOrThrow({ where: { id: theirs.id } });
      expect(stored.revokedAt).toBeNull();
    });

    it('returns 404 for an unknown id', async () => {
      await request(server())
        .delete('/api-keys/0190f6a0-0000-7000-8000-000000000000')
        .set('Cookie', cookie)
        .expect(404);
    });

    it('returns 400 for an id that is not a UUID', async () => {
      await request(server()).delete('/api-keys/not-a-uuid').set('Cookie', cookie).expect(400);
    });
  });

  describe('API key authentication (GET /v1/me)', () => {
    it('identifies the key and its user', async () => {
      const created = await createKey('production');

      const response = await request(server())
        .get('/v1/me')
        .set('Authorization', `Bearer ${created.key}`)
        .expect(200);

      expect(response.body).toEqual({
        apiKey: { id: created.id, name: 'production', prefix: created.prefix },
        user: { id: user.id, email: user.email },
      });
    });

    it('accepts a lowercase "bearer" scheme', async () => {
      const { key } = await createKey();

      await request(server()).get('/v1/me').set('Authorization', `bearer ${key}`).expect(200);
    });

    it('returns 401 with WWW-Authenticate when the header is missing', async () => {
      const response = await request(server()).get('/v1/me').expect(401);

      expect(response.headers['www-authenticate']).toBe('Bearer');
    });

    it.each([
      ['a non-Bearer scheme', 'Basic dXNlcjpwYXNz'],
      ['an empty Bearer token', 'Bearer '],
      ['two tokens', 'Bearer one two'],
    ])('returns 401 for %s', async (_label, header) => {
      await request(server()).get('/v1/me').set('Authorization', header).expect(401);
    });

    it('returns 401 for a malformed key', async () => {
      const response = await request(server())
        .get('/v1/me')
        .set('Authorization', 'Bearer not-a-real-key')
        .expect(401);

      expect(response.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    });

    it('returns 401 for a well-formed key that does not exist', async () => {
      await request(server())
        .get('/v1/me')
        .set('Authorization', `Bearer ${generateApiKey().key}`)
        .expect(401);
    });

    it('returns 401 for a revoked key', async () => {
      const { id, key } = await createKey();
      await request(server()).delete(`/api-keys/${id}`).set('Cookie', cookie).expect(204);

      await request(server()).get('/v1/me').set('Authorization', `Bearer ${key}`).expect(401);
    });

    it('returns 401 once the owner is removed from ALLOWED_EMAILS', async () => {
      const removed = await createUser(t.prisma, { email: 'removed@example.com' });
      const { key, prefix, hash } = generateApiKey();
      await t.prisma.apiKey.create({
        data: { userId: removed.id, name: 'old', prefix, keyHash: hash },
      });

      await request(server()).get('/v1/me').set('Authorization', `Bearer ${key}`).expect(401);
    });

    it('does not accept a session cookie instead of an API key', async () => {
      await request(server()).get('/v1/me').set('Cookie', cookie).expect(401);
    });

    it('records when a key was last used, at most once a minute', async () => {
      const { id, key } = await createKey();
      const call = () =>
        request(server()).get('/v1/me').set('Authorization', `Bearer ${key}`).expect(200);

      await call();
      const firstUse = (await t.prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt;
      expect(firstUse).toBeInstanceOf(Date);

      // A second call within the minute doesn't write again.
      await call();
      const secondUse = (await t.prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt;
      expect(secondUse).toEqual(firstUse);

      // Once the recorded use is older than a minute, it is updated.
      const twoMinutesAgo = new Date(Date.now() - 2 * 60_000);
      await t.prisma.apiKey.update({ where: { id }, data: { lastUsedAt: twoMinutesAgo } });
      await call();
      const thirdUse = (await t.prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt;
      expect(thirdUse?.getTime()).toBeGreaterThan(twoMinutesAgo.getTime());
    });
  });
});
