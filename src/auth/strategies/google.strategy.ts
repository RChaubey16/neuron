import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { GoogleProfile } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  /** Maps the verified Google profile to the `{ sub, email }` shape `AuthService` expects. */
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const emailEntry = profile.emails?.[0];
    if (!emailEntry) {
      done(new Error('Google profile has no email'), false);
      return;
    }
    // AuthService.findOrCreateUser links a login to an existing User row by
    // email, so an unverified email here would let an attacker take over
    // any existing account by claiming its email on a Google account they
    // control without proving ownership of it.
    if (!emailEntry.verified) {
      done(new Error('Google profile email is not verified'), false);
      return;
    }
    const googleProfile: GoogleProfile = {
      sub: profile.id,
      email: emailEntry.value,
    };
    done(null, googleProfile);
  }
}
