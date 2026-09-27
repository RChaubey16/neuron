import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

/**
 * Applied only to `GET /auth/google/callback`, which a browser reaches
 * mid-redirect rather than an API client. Any failure there (the user
 * cancelled on Google's consent screen, `GoogleStrategy` rejected an
 * unverified email, the DB write failed) is sent back to the dashboard's
 * callback page instead of rendering `GlobalExceptionFilter`'s raw JSON in
 * the browser. The callback page already treats "no token in the fragment"
 * as a failed sign-in.
 */
@Catch()
export class OAuthCallbackRedirectFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthCallbackRedirectFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const cancelled =
      exception instanceof HttpException && exception.getStatus() === 401;

    if (cancelled) {
      this.logger.warn('Google sign-in was cancelled or not authorized');
    } else {
      this.logger.error(
        'Google sign-in callback failed',
        exception instanceof Error ? exception.stack : exception,
      );
    }

    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const error = cancelled ? 'access_denied' : 'sign_in_failed';
    response.redirect(`${frontendUrl}/auth/callback#error=${error}`);
  }
}
