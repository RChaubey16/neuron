import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
} from 'jose';
import type { AuthUser } from '@/common/interfaces/auth-user.interface.js';
import type { AppConfig } from '@/config/configuration.js';
import {
  ACCEPTED_JWT_ALGORITHMS,
  AuthErrorMessage,
  JWT_CLOCK_TOLERANCE_SECONDS,
  SUPABASE_JWKS,
} from './auth.constants.js';

/** Claims Supabase adds to its access tokens (only the ones we read). */
interface SupabaseClaims extends JWTPayload {
  role?: unknown;
  is_anonymous?: unknown;
  email?: unknown;
  user_metadata?: unknown;
}

/**
 * jose error codes that mean "this token is bad" (401). Anything else,
 * such as a JWKS fetch failure or timeout, is our problem (503).
 */
const INVALID_TOKEN_ERROR_CODES = new Set<string>([
  errors.JWTClaimValidationFailed.code,
  errors.JWTInvalid.code,
  errors.JWSInvalid.code,
  errors.JWSSignatureVerificationFailed.code,
  errors.JOSEAlgNotAllowed.code,
  errors.JOSENotSupported.code,
  errors.JWKSNoMatchingKey.code,
  errors.JWKSMultipleMatchingKeys.code,
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly verifyOptions: JWTVerifyOptions;

  constructor(
    @Inject(SUPABASE_JWKS) private readonly jwks: JWTVerifyGetKey,
    config: ConfigService<AppConfig, true>,
  ) {
    const { issuer, audience } = config.get('auth', { infer: true });
    this.verifyOptions = {
      issuer,
      audience,
      algorithms: ACCEPTED_JWT_ALGORITHMS,
      clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['sub', 'exp', 'iat'],
    };
  }

  /**
   * Verifies a Supabase access token (signature, algorithm, issuer,
   * audience, expiry, and Neuron's own claim rules) and returns the user.
   *
   * @throws UnauthorizedException when the token is invalid or expired.
   * @throws ServiceUnavailableException when the signing keys cannot be
   *   loaded from Supabase.
   */
  async verifyAccessToken(token: string): Promise<AuthUser> {
    let claims: SupabaseClaims;
    try {
      ({ payload: claims } = await jwtVerify<SupabaseClaims>(
        token,
        this.jwks,
        this.verifyOptions,
      ));
    } catch (error) {
      throw this.toHttpError(error);
    }
    return toAuthUser(claims);
  }

  private toHttpError(error: unknown): HttpException {
    if (error instanceof errors.JWTExpired) {
      return new UnauthorizedException(AuthErrorMessage.Expired);
    }
    if (
      error instanceof errors.JOSEError &&
      INVALID_TOKEN_ERROR_CODES.has(error.code)
    ) {
      return new UnauthorizedException(AuthErrorMessage.Invalid);
    }
    // Never log the token itself.
    this.logger.error(
      `Could not verify access token: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    return new ServiceUnavailableException(AuthErrorMessage.Unavailable);
  }
}

/**
 * Applies Neuron's rules on top of the standard checks: a UUID user ID,
 * the `authenticated` role, and no anonymous users (Google only).
 */
function toAuthUser(claims: SupabaseClaims): AuthUser {
  const { sub, role, is_anonymous: isAnonymous } = claims;
  if (
    typeof sub !== 'string' ||
    !UUID_PATTERN.test(sub) ||
    role !== 'authenticated' ||
    isAnonymous === true
  ) {
    throw new UnauthorizedException(AuthErrorMessage.Invalid);
  }

  const metadata = isRecord(claims.user_metadata) ? claims.user_metadata : {};
  return {
    id: sub.toLowerCase(),
    email: stringOrNull(claims.email),
    fullName: stringOrNull(metadata.full_name) ?? stringOrNull(metadata.name),
    avatarUrl:
      stringOrNull(metadata.avatar_url) ?? stringOrNull(metadata.picture),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
