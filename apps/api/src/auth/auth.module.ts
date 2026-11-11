import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';
import type { AppConfig } from '@/config/configuration.js';
import { SUPABASE_JWKS } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

/**
 * Verifies Supabase login tokens. There are no login endpoints here: the
 * web app signs in with Supabase directly and sends the access token.
 */
@Module({
  providers: [
    {
      provide: SUPABASE_JWKS,
      inject: [ConfigService],
      // Fetched lazily on the first request, then cached. Unknown key IDs
      // trigger a refetch at most once per cooldown period, so key
      // rotation in Supabase is picked up without a restart.
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createRemoteJWKSet(
          new URL(config.get('auth.jwksUrl', { infer: true })),
          {
            timeoutDuration: 3_000,
            cooldownDuration: 30_000,
            cacheMaxAge: 10 * 60_000,
          },
        ),
    },
    AuthService,
    JwtAuthGuard,
  ],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
