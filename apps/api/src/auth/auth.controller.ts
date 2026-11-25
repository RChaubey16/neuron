import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@neuron/db';
import type { Request, Response } from 'express';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { AuthService, SignInError } from './auth.service.js';
import {
  clearOptions,
  OAUTH_COOKIE,
  oauthCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './cookies.js';
import { CurrentUser } from './current-user.decorator.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { SessionGuard } from './session.guard.js';

/** Error codes the dashboard's sign-in page receives as `?error=<code>`. */
export type CallbackErrorCode =
  | 'access_denied'
  | 'google_error'
  | 'invalid_state'
  | 'invalid_request'
  | 'email_not_verified'
  | 'not_allowed'
  | 'server_error';

export interface UserResponse {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface OAuthCookie {
  state: string;
  codeVerifier: string;
}

function parseOAuthCookie(value: unknown): OAuthCookie | null {
  // cookie-parser gives `false` for a signed cookie whose signature doesn't match.
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'state' in parsed &&
      'codeVerifier' in parsed &&
      typeof parsed.state === 'string' &&
      typeof parsed.codeVerifier === 'string'
    ) {
      return { state: parsed.state, codeVerifier: parsed.codeVerifier };
    }
  } catch {
    // Malformed JSON: treated the same as a missing cookie.
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function toUserResponse(user: User): UserResponse {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly webUrl: string;
  private readonly cookieEnv: Pick<EnvironmentVariables, 'NODE_ENV' | 'COOKIE_DOMAIN'>;

  constructor(
    private readonly google: GoogleOAuthService,
    private readonly auth: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.webUrl = new URL(config.get('WEB_URL', { infer: true })).origin;
    this.cookieEnv = {
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      COOKIE_DOMAIN: config.get('COOKIE_DOMAIN', { infer: true }),
    };
  }

  /** Step 1: send the browser to Google's consent screen. */
  @Get('google')
  async startGoogleSignIn(@Res() res: Response): Promise<void> {
    const { url, state, codeVerifier } = await this.google.createAuthorizationRequest();
    const cookie: OAuthCookie = { state, codeVerifier };

    res.cookie(OAUTH_COOKIE, JSON.stringify(cookie), oauthCookieOptions(this.cookieEnv));
    res.redirect(302, url);
  }

  /** Step 2: Google sends the browser back here with a code (or an error). */
  @Get('google/callback')
  async finishGoogleSignIn(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Query('error') error: unknown,
  ): Promise<void> {
    const stored = parseOAuthCookie(req.signedCookies?.[OAUTH_COOKIE]);
    // One attempt per cookie, whatever the outcome.
    res.clearCookie(OAUTH_COOKIE, clearOptions(oauthCookieOptions(this.cookieEnv)));

    if (error !== undefined) {
      return this.redirectWithError(
        res,
        error === 'access_denied' ? 'access_denied' : 'google_error',
      );
    }
    if (!stored || typeof state !== 'string' || !safeEqual(state, stored.state)) {
      return this.redirectWithError(res, 'invalid_state');
    }
    if (typeof code !== 'string' || code.length === 0) {
      return this.redirectWithError(res, 'invalid_request');
    }

    let user: User;
    try {
      const profile = await this.google.getProfile(code, stored.codeVerifier);
      user = await this.auth.signIn(profile);
    } catch (caught) {
      if (caught instanceof SignInError) {
        this.logger.warn(`Refused Google sign-in: ${caught.code}`);
        return this.redirectWithError(res, caught.code);
      }
      this.logger.error(`Google sign-in failed: ${String(caught)}`);
      return this.redirectWithError(res, 'google_error');
    }

    try {
      const token = await this.auth.createSessionToken(user);
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.cookieEnv));
    } catch (caught) {
      this.logger.error(`Could not create a session: ${String(caught)}`);
      return this.redirectWithError(res, 'server_error');
    }

    res.redirect(302, `${this.webUrl}/`);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: User): UserResponse {
    return toUserResponse(user);
  }

  /** Always succeeds, so a stale or invalid session can still be cleared. */
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, clearOptions(sessionCookieOptions(this.cookieEnv)));
  }

  private redirectWithError(res: Response, code: CallbackErrorCode): void {
    const url = new URL('/sign-in', this.webUrl);
    url.searchParams.set('error', code);
    res.redirect(302, url.toString());
  }
}
