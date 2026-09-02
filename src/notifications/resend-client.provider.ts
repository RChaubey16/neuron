import { ConfigService } from '@nestjs/config';
import { Provider } from '@nestjs/common';
import { Resend } from 'resend';

export const RESEND_CLIENT = 'RESEND_CLIENT';

export const resendClientProvider: Provider = {
  provide: RESEND_CLIENT,
  useFactory: (configService: ConfigService) =>
    new Resend(configService.getOrThrow<string>('RESEND_API_KEY')),
  inject: [ConfigService],
};
