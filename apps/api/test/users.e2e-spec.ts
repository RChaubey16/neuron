import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { SUPABASE_JWKS } from '../src/auth/auth.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestTokenSigner,
  type TestTokenSigner,
} from './support/supabase-tokens.js';

describe('Users (e2e, test database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let signer: TestTokenSigner;
  const createdUserIds: string[] = [];

  /**
   * Adds a user to the stub auth.users table.
   *
   * @returns The new user's ID.
   */
  async function createAuthUser(): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    createdUserIds.push(id);
    return id;
  }

  /**
   * Signs an access token for a user.
   *
   * @param sub - User ID.
   * @param claims - Extra or overriding claims.
   * @returns The `Authorization` header value.
   */
  async function bearer(
    sub: string,
    claims: Record<string, unknown> = {},
  ): Promise<string> {
    return `Bearer ${await signer.sign({ sub, ...claims })}`;
  }

  beforeAll(async () => {
    signer = await createTestTokenSigner();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUPABASE_JWKS)
      .useValue(signer.jwks)
      .compile();

    app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Profiles go with their users (ON DELETE CASCADE).
    await prisma.$executeRaw`
      DELETE FROM auth.users WHERE id = ANY(${createdUserIds}::uuid[])`;
    await app.close();
  });

  describe('authentication', () => {
    it.each(['get', 'patch'] as const)(
      '%s /users/me requires a token',
      async (method) => {
        const res = await request(app.getHttpServer())
          [method]('/api/v1/users/me')
          .expect(401);
        expect(res.body.message).toBe('Missing bearer token');
      },
    );

    it('rejects a valid token for a user deleted from Supabase', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', await bearer(randomUUID()))
        .expect(401);
      expect(res.body.message).toBe('Invalid access token');
    });
  });

  describe('GET /api/v1/users/me', () => {
    it('creates the profile from the token on the first call', async () => {
      const id = await createAuthUser();
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', await bearer(id))
        .expect(200);

      expect(res.body).toEqual({
        id,
        email: 'user@example.com',
        fullName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      await expect(prisma.profile.count({ where: { id } })).resolves.toBe(1);
    });

    it('syncs the email on later calls but keeps name and avatar', async () => {
      const id = await createAuthUser();
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', await bearer(id))
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set(
          'Authorization',
          await bearer(id, {
            email: 'changed@example.com',
            user_metadata: { full_name: 'Google Name', avatar_url: null },
          }),
        )
        .expect(200);

      expect(res.body).toMatchObject({
        email: 'changed@example.com',
        fullName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
      });
    });

    it('returns only the caller’s own profile', async () => {
      const alice = await createAuthUser();
      const bob = await createAuthUser();

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', await bearer(bob, { email: 'bob@example.com' }))
        .expect(200);
      expect(res.body).toMatchObject({ id: bob, email: 'bob@example.com' });

      const aliceRes = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', await bearer(alice))
        .expect(200);
      expect(aliceRes.body.id).toBe(alice);
    });
  });

  describe('PATCH /api/v1/users/me', () => {
    it('updates name and avatar, and later sign-ins keep them', async () => {
      const id = await createAuthUser();
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', await bearer(id))
        .send({
          fullName: '  Ada Lovelace ',
          avatarUrl: 'https://cdn.example.com/ada.png',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id,
        fullName: 'Ada Lovelace',
        avatarUrl: 'https://cdn.example.com/ada.png',
      });

      const after = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', await bearer(id))
        .expect(200);
      expect(after.body).toMatchObject({
        fullName: 'Ada Lovelace',
        avatarUrl: 'https://cdn.example.com/ada.png',
      });
    });

    it('clears fields set to null and keeps omitted ones', async () => {
      const id = await createAuthUser();
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', await bearer(id))
        .send({ avatarUrl: null })
        .expect(200);

      expect(res.body).toMatchObject({
        fullName: 'Test User',
        avatarUrl: null,
      });
    });

    it('rejects invalid and non-editable fields', async () => {
      const id = await createAuthUser();
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', await bearer(id))
        .send({
          fullName: '',
          avatarUrl: 'http://example.com/a.png',
          email: 'x@example.com',
        })
        .expect(400);

      expect(res.body.error).toBe('Bad Request');
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'property email should not exist',
          'avatarUrl must be an https URL',
          expect.stringContaining('fullName'),
        ]),
      );
      await expect(prisma.profile.count({ where: { id } })).resolves.toBe(0);
    });
  });

  describe('profiles table', () => {
    it('is deleted with the Supabase user', async () => {
      const id = await createAuthUser();
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', await bearer(id))
        .expect(200);

      await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ${id}::uuid`;
      await expect(prisma.profile.count({ where: { id } })).resolves.toBe(0);
    });

    it('has row level security enabled', async () => {
      const rows = await prisma.$queryRaw<{ rls: boolean }[]>`
        SELECT relrowsecurity AS rls FROM pg_class
        WHERE oid = 'public.profiles'::regclass`;
      expect(rows[0]?.rls).toBe(true);
    });
  });
});
