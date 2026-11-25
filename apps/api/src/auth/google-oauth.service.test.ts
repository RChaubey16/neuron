import { ConfigService } from '@nestjs/config';
import type { LoginTicket, TokenPayload } from 'google-auth-library';
import { OAuth2Client } from 'google-auth-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleOAuthError, GoogleOAuthService } from './google-oauth.service.js';

const CLIENT_ID = 'client-id.apps.googleusercontent.com';
const CALLBACK_URL = 'http://localhost:4000/auth/google/callback';

function createService(): GoogleOAuthService {
  const values: Record<string, string> = {
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_CALLBACK_URL: CALLBACK_URL,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<never, true>;
  return new GoogleOAuthService(config);
}

/**
 * Stubs Google's token endpoint and ID-token verification. Both methods are
 * overloaded with callback versions, so the resolved values are cast.
 */
function stubGoogle(idToken: string | null, payload?: TokenPayload) {
  const getToken = vi
    .spyOn(OAuth2Client.prototype, 'getToken')
    .mockResolvedValue({ tokens: { id_token: idToken }, res: null } as never);
  const verifyIdToken = vi
    .spyOn(OAuth2Client.prototype, 'verifyIdToken')
    .mockResolvedValue({ getPayload: () => payload } as LoginTicket as never);
  return { getToken, verifyIdToken };
}

const basePayload: TokenPayload = {
  iss: 'https://accounts.google.com',
  sub: '1234567890',
  aud: CLIENT_ID,
  iat: 0,
  exp: 0,
  email: 'Person@Example.com',
  email_verified: true,
  name: 'A Person',
  picture: 'https://example.com/p.png',
};

describe('GoogleOAuthService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createAuthorizationRequest', () => {
    it('builds a Google URL with state, an S256 PKCE challenge and the OpenID scopes', async () => {
      const { url, state, codeVerifier } = await createService().createAuthorizationRequest();
      const parsed = new URL(url);

      expect(parsed.hostname).toBe('accounts.google.com');
      expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(parsed.searchParams.get('redirect_uri')).toBe(CALLBACK_URL);
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('scope')).toBe('openid email profile');
      expect(parsed.searchParams.get('state')).toBe(state);
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
      // The verifier itself never goes to Google at this stage.
      expect(url).not.toContain(codeVerifier);
    });

    it('uses a fresh, unguessable state every time', async () => {
      const service = createService();
      const a = await service.createAuthorizationRequest();
      const b = await service.createAuthorizationRequest();

      expect(a.state).not.toBe(b.state);
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
      expect(a.state.length).toBeGreaterThanOrEqual(43);
    });
  });

  describe('getProfile', () => {
    it('exchanges the code with the PKCE verifier and maps the verified ID token', async () => {
      const { getToken, verifyIdToken } = stubGoogle('id-token', basePayload);

      const profile = await createService().getProfile('code', 'verifier');

      expect(getToken).toHaveBeenCalledWith({ code: 'code', codeVerifier: 'verifier' });
      expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'id-token', audience: CLIENT_ID });
      expect(profile).toEqual({
        googleId: '1234567890',
        email: 'person@example.com',
        emailVerified: true,
        name: 'A Person',
        avatarUrl: 'https://example.com/p.png',
      });
    });

    it('treats a missing email_verified as unverified and missing name/picture as null', async () => {
      stubGoogle('id-token', {
        ...basePayload,
        email_verified: undefined,
        name: undefined,
        picture: undefined,
      });

      const profile = await createService().getProfile('code', 'verifier');

      expect(profile.emailVerified).toBe(false);
      expect(profile.name).toBeNull();
      expect(profile.avatarUrl).toBeNull();
    });

    it('fails when Google returns no ID token', async () => {
      stubGoogle(null);

      await expect(createService().getProfile('code', 'verifier')).rejects.toThrow(
        GoogleOAuthError,
      );
    });

    it('fails when the ID token has no email', async () => {
      stubGoogle('id-token', { ...basePayload, email: undefined });

      await expect(createService().getProfile('code', 'verifier')).rejects.toThrow(/email/);
    });

    it('fails when the ID token does not verify', async () => {
      stubGoogle('id-token', basePayload).verifyIdToken.mockRejectedValue(
        new Error('Wrong recipient'),
      );

      await expect(createService().getProfile('code', 'verifier')).rejects.toThrow(
        'Wrong recipient',
      );
    });
  });
});
