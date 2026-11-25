import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@neuron/db';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { GoogleProfile } from './google-oauth.service.js';

/** Why a Google account was refused. Sent to the dashboard as `?error=<code>`. */
export type SignInErrorCode = 'email_not_verified' | 'not_allowed';

export class SignInError extends Error {
  override readonly name = 'SignInError';

  constructor(readonly code: SignInErrorCode) {
    super(`Sign-in refused: ${code}`);
  }
}

interface SessionPayload {
  sub: string;
}

@Injectable()
export class AuthService {
  private readonly allowedEmails: ReadonlySet<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.allowedEmails = new Set(config.get('ALLOWED_EMAILS', { infer: true }));
  }

  /** Whether this email may use Neuron. Checked at sign-in and on every request. */
  isAllowed(email: string): boolean {
    return this.allowedEmails.has(email.toLowerCase());
  }

  /** Creates the user on first sign-in, or refreshes their profile on later ones. */
  async signIn(profile: GoogleProfile): Promise<User> {
    if (!profile.emailVerified) throw new SignInError('email_not_verified');
    if (!this.isAllowed(profile.email)) throw new SignInError('not_allowed');

    const details = { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl };
    return this.prisma.user.upsert({
      where: { googleId: profile.googleId },
      create: { googleId: profile.googleId, ...details },
      update: { ...details, lastLoginAt: new Date() },
    });
  }

  createSessionToken(user: Pick<User, 'id'>): Promise<string> {
    const payload: SessionPayload = { sub: user.id };
    return this.jwt.signAsync(payload);
  }

  /**
   * Returns the user a session token belongs to, or null if the token is
   * invalid or expired, the user no longer exists, or they were removed from
   * ALLOWED_EMAILS since signing in.
   */
  async getUserFromSession(token: string): Promise<User | null> {
    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      return null;
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    return user && this.isAllowed(user.email) ? user : null;
  }
}
