import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProviderName, type EnvironmentVariables } from '../config/env.validation.js';
import { EmailChannel } from './email.channel.js';
import { EMAIL_PROVIDER } from './email-provider.js';
import { SmtpProvider } from './smtp.provider.js';

@Module({
  providers: [
    SmtpProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, SmtpProvider],
      useFactory: (config: ConfigService<EnvironmentVariables, true>, smtp: SmtpProvider) => {
        const name = config.get('EMAIL_PROVIDER', { infer: true });
        switch (name) {
          case EmailProviderName.Smtp:
            return smtp;
        }
      },
    },
    EmailChannel,
  ],
  exports: [EmailChannel],
})
export class EmailModule {}
