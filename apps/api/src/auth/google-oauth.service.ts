import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { EnvironmentVariables } from '../config/env.validation.js';

export interface GoogleAuthorizationRequest {
  /** Google's consent screen URL to redirect the browser to. */
  url: string;
  /** Random value echoed back by Google; ties the callback to this browser. */
  state: string;
  /** PKCE secret; only its hash goes to Google until the code is exchanged. */
  codeVerifier: string;
}

export interface GoogleProfile {
  googleId: string;
  /** Lowercase. */
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

/** Thrown when Google's response can't be trusted or used. */
export class GoogleOAuthError extends Error {
  override readonly name = 'GoogleOAuthError';
}

/**
 * The OAuth 2.0 authorization-code flow with PKCE against Google, using
 * google-auth-library. Kept behind this service so tests can replace it.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly client: OAuth2Client;
  private readonly clientId: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.clientId = config.get('GOOGLE_CLIENT_ID', { infer: true });
    this.client = new OAuth2Client({
      clientId: this.clientId,
      clientSecret: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      redirectUri: config.get('GOOGLE_CALLBACK_URL', { infer: true }),
    });
  }

  async createAuthorizationRequest(): Promise<GoogleAuthorizationRequest> {
    const state = randomBytes(32).toString('base64url');
    const { codeVerifier, codeChallenge } = await this.client.generateCodeVerifierAsync();
    if (!codeChallenge) {
      throw new GoogleOAuthError('Could not create a PKCE code challenge');
    }

    const url = this.client.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      access_type: 'online',
      prompt: 'select_account',
    });

    return { url, state, codeVerifier };
  }

  /**
   * Exchanges the authorization code for tokens and returns the profile from
   * the ID token, after verifying its signature, issuer, audience and expiry.
   */
  async getProfile(code: string, codeVerifier: string): Promise<GoogleProfile> {
    const { tokens } = await this.client.getToken({ code, codeVerifier });
    if (!tokens.id_token) {
      throw new GoogleOAuthError('Google did not return an ID token');
    }

    const ticket = await this.client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new GoogleOAuthError('Google ID token is missing the account ID or email');
    }

    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
    };
  }
}
