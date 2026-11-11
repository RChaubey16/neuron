import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose';

/** Fake Supabase project used by tests. No request ever reaches it. */
export const TEST_SUPABASE_URL = 'https://test-project.supabase.co';
export const TEST_ISSUER = `${TEST_SUPABASE_URL}/auth/v1`;
export const TEST_USER_ID = '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60';
export const TEST_KID = 'test-key-1';

export interface SignOptions {
  /** Signing key; defaults to the signer's own private key. */
  key?: CryptoKey | Uint8Array;
  alg?: string;
  kid?: string;
}

export interface TestTokenSigner {
  /** Key set holding the signer's public key, to stand in for the JWKS. */
  jwks: JWTVerifyGetKey;
  /**
   * Signs a Supabase-like access token. `claims` override the defaults;
   * a claim set to `undefined` is left out.
   */
  sign(
    claims?: Record<string, unknown>,
    options?: SignOptions,
  ): Promise<string>;
}

/**
 * Creates an ES256 key pair and a signer for Supabase-like tokens.
 *
 * @returns The signer and the key set that verifies its tokens.
 */
export async function createTestTokenSigner(): Promise<TestTokenSigner> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: TEST_KID,
    alg: 'ES256',
    use: 'sig',
  };

  return {
    jwks: createLocalJWKSet({ keys: [publicJwk] }),
    sign: async (claims = {}, options = {}) => {
      const now = Math.floor(Date.now() / 1000);
      const payload = Object.fromEntries(
        Object.entries({
          iss: TEST_ISSUER,
          aud: 'authenticated',
          sub: TEST_USER_ID,
          role: 'authenticated',
          is_anonymous: false,
          email: 'user@example.com',
          user_metadata: {
            full_name: 'Test User',
            avatar_url: 'https://example.com/avatar.png',
          },
          iat: now,
          exp: now + 3600,
          ...claims,
        }).filter(([, value]) => value !== undefined),
      );

      return new SignJWT(payload)
        .setProtectedHeader({
          alg: options.alg ?? 'ES256',
          kid: options.kid ?? TEST_KID,
          typ: 'JWT',
        })
        .sign(options.key ?? privateKey);
    },
  };
}
