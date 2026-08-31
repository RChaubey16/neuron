import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '../../generated/prisma';

/** The subset of a verified Google OAuth profile AuthService needs. */
export interface GoogleProfile {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Finds the local `User` row for a Google account, creating it on this
   * user's first login.
   *
   * @param profile - The `sub`/`email` pulled from the verified Google OAuth profile
   * @returns The local User row matching the Google account
   */
  async findOrCreateUser(profile: GoogleProfile): Promise<User> {
    return this.prisma.user.upsert({
      where: { id: profile.sub },
      update: {},
      create: { id: profile.sub, email: profile.email },
    });
  }

  /**
   * Signs a Nest-issued session JWT for a local user.
   *
   * @param user - The local User row to encode
   * @returns A signed JWT string, expiring per `JWT_EXPIRES_IN`
   */
  async signToken(user: User): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id, email: user.email });
  }
}
