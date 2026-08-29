import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '../../generated/prisma';

@Injectable()
export class AuthService {
  private readonly jwks: JWTVerifyGetKey;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const supabaseUrl = configService.get<string>('SUPABASE_URL');
    // Supabase signs access tokens with a rotating asymmetric key (ES256) —
    // verifying against its published JWKS avoids needing any shared secret
    // in this codebase, and keeps working across key rotation automatically.
    this.jwks = createRemoteJWKSet(
      new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
    );
  }

  /**
   * Verifies a Supabase-issued access token against Supabase's JWKS and
   * returns the local `User` row for its subject, creating that row if this
   * is the user's first authenticated request.
   * Throws an UnauthorizedException if the token is missing, expired, has an
   * invalid signature, or is missing the claims needed to sync a user.
   *
   * @param token - Raw bearer token from the `Authorization` header
   * @returns The local User row matching the token's `sub` claim
   */
  async verifyAndSyncUser(token: string): Promise<User> {
    let sub: string;
    let email: string;
    try {
      const { payload } = await jwtVerify(token, this.jwks);
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string'
      ) {
        throw new Error('Missing sub/email claim');
      }
      sub = payload.sub;
      email = payload.email;
    } catch {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    // Supabase's auth.users row exists before ours does; create it lazily on
    // whichever authenticated request happens to arrive first for this user.
    return this.prisma.user.upsert({
      where: { id: sub },
      update: {},
      create: { id: sub, email },
    });
  }
}
