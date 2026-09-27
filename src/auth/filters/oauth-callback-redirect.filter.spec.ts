import {
  ArgumentsHost,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthCallbackRedirectFilter } from './oauth-callback-redirect.filter';

describe('OAuthCallbackRedirectFilter', () => {
  const frontendUrl = 'https://neuron.example.com';
  let filter: OAuthCallbackRedirectFilter;
  let response: { redirect: jest.Mock };
  let host: ArgumentsHost;

  beforeEach(() => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue(frontendUrl),
    } as unknown as ConfigService;
    filter = new OAuthCallbackRedirectFilter(configService);
    response = { redirect: jest.fn() };
    host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
  });

  it('redirects a cancelled/unauthorized sign-in back to the dashboard with access_denied', () => {
    filter.catch(new UnauthorizedException(), host);

    expect(response.redirect).toHaveBeenCalledWith(
      `${frontendUrl}/auth/callback#error=access_denied`,
    );
  });

  it('redirects any other failure (e.g. an unverified Google email) with sign_in_failed', () => {
    filter.catch(new Error('Google profile email is not verified'), host);
    filter.catch(new InternalServerErrorException(), host);

    expect(response.redirect).toHaveBeenNthCalledWith(
      1,
      `${frontendUrl}/auth/callback#error=sign_in_failed`,
    );
    expect(response.redirect).toHaveBeenNthCalledWith(
      2,
      `${frontendUrl}/auth/callback#error=sign_in_failed`,
    );
  });

  it('never puts the error message itself in the redirect URL', () => {
    filter.catch(new Error('secret internal detail'), host);

    const [url] = response.redirect.mock.calls[0] as [string];
    expect(url).not.toContain('secret');
  });
});
