import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { errors, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import {
  createTestTokenSigner,
  TEST_ISSUER,
  TEST_USER_ID,
  type TestTokenSigner,
} from '../../test/support/supabase-tokens.js';
import type { AppConfig } from '@/config/configuration.js';
import { AuthErrorMessage } from './auth.constants.js';
import { AuthService } from './auth.service.js';

function createService(jwks: JWTVerifyGetKey): AuthService {
  const config = {
    get: () => ({
      issuer: TEST_ISSUER,
      audience: 'authenticated',
      jwksUrl: `${TEST_ISSUER}/.well-known/jwks.json`,
    }),
  } as unknown as ConfigService<AppConfig, true>;
  return new AuthService(jwks, config);
}

async function expectRejection(
  promise: Promise<unknown>,
  type: typeof UnauthorizedException | typeof ServiceUnavailableException,
  message: string,
): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as Error).message).toBe(message);
}

describe('AuthService', () => {
  let signer: TestTokenSigner;
  let service: AuthService;
  const now = (): number => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    signer = await createTestTokenSigner();
    service = createService(signer.jwks);
  });

  it('returns the user for a valid token', async () => {
    const user = await service.verifyAccessToken(await signer.sign());
    expect(user).toEqual({
      id: TEST_USER_ID,
      email: 'user@example.com',
      fullName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
    });
  });

  it('falls back to Google `name` and `picture`, and to null', async () => {
    const withFallbacks = await service.verifyAccessToken(
      await signer.sign({
        user_metadata: { name: 'Fallback', picture: 'https://x.test/p.png' },
      }),
    );
    expect(withFallbacks).toMatchObject({
      fullName: 'Fallback',
      avatarUrl: 'https://x.test/p.png',
    });

    const bare = await service.verifyAccessToken(
      await signer.sign({ email: undefined, user_metadata: undefined }),
    );
    expect(bare).toMatchObject({
      email: null,
      fullName: null,
      avatarUrl: null,
    });
  });

  it('accepts a token within the clock tolerance', async () => {
    await expect(
      service.verifyAccessToken(await signer.sign({ exp: now() - 2 })),
    ).resolves.toMatchObject({ id: TEST_USER_ID });
  });

  it('rejects an expired token with a specific message', async () => {
    await expectRejection(
      service.verifyAccessToken(
        await signer.sign({ iat: now() - 7200, exp: now() - 3600 }),
      ),
      UnauthorizedException,
      AuthErrorMessage.Expired,
    );
  });

  describe('rejects invalid tokens', () => {
    const cases: Array<[string, () => Promise<string>]> = [
      ['malformed', async () => 'not-a-jwt'],
      ['wrong issuer', () => signer.sign({ iss: 'https://evil.test/auth/v1' })],
      ['wrong audience', () => signer.sign({ aud: 'anon' })],
      ['missing sub', () => signer.sign({ sub: undefined })],
      ['non-UUID sub', () => signer.sign({ sub: 'user-1' })],
      ['missing exp', () => signer.sign({ exp: undefined })],
      ['missing iat', () => signer.sign({ iat: undefined })],
      ['non-authenticated role', () => signer.sign({ role: 'service_role' })],
      ['anonymous user', () => signer.sign({ is_anonymous: true })],
      ['unknown key ID', () => signer.sign({}, { kid: 'other-key' })],
      [
        'signed by another key',
        async () => {
          const other = await generateKeyPair('ES256');
          return signer.sign({}, { key: other.privateKey });
        },
      ],
      [
        'symmetric HS256',
        () => signer.sign({}, { alg: 'HS256', key: new Uint8Array(32) }),
      ],
      [
        'unsigned (alg none)',
        async () => {
          const [, payload] = (await signer.sign()).split('.');
          const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString(
            'base64url',
          );
          return `${header}.${payload}.`;
        },
      ],
      [
        'tampered payload',
        async () => {
          const [header, , signature] = (await signer.sign()).split('.');
          const forged = Buffer.from(
            JSON.stringify({ sub: TEST_USER_ID, role: 'service_role' }),
          ).toString('base64url');
          return `${header}.${forged}.${signature}`;
        },
      ],
    ];

    it.each(cases)('%s', async (_name, makeToken) => {
      await expectRejection(
        service.verifyAccessToken(await makeToken()),
        UnauthorizedException,
        AuthErrorMessage.Invalid,
      );
    });
  });

  describe('when the signing keys cannot be loaded', () => {
    it.each([
      ['network failure', new TypeError('fetch failed')],
      ['timeout', new errors.JWKSTimeout()],
      ['bad JWKS response', new errors.JOSEError('Expected 200 OK')],
    ])('returns 503 on %s', async (_name, failure) => {
      const failing = createService(() => Promise.reject(failure));
      await expectRejection(
        failing.verifyAccessToken(await signer.sign()),
        ServiceUnavailableException,
        AuthErrorMessage.Unavailable,
      );
    });
  });
});
