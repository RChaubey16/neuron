import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { EmailProviderName, type EnvironmentVariables } from '../config/env.validation.js';
import { EmailChannel } from './email.channel.js';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.js';
import { ResendProvider } from './resend.provider.js';
import { SmtpProvider } from './smtp.provider.js';

const PROVIDERS = {
  [EmailProviderName.Smtp]: SmtpProvider,
  [EmailProviderName.Resend]: ResendProvider,
} satisfies Record<EmailProviderName, new (...args: never[]) => EmailProvider>;

@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, ModuleRef],
      // Only the configured provider is created: Resend needs no API key when
      // sending through SMTP, and no SMTP pool exists when sending through Resend.
      useFactory: (config: ConfigService<EnvironmentVariables, true>, moduleRef: ModuleRef) =>
        moduleRef.create<EmailProvider>(PROVIDERS[config.get('EMAIL_PROVIDER', { infer: true })]),
    },
    EmailChannel,
  ],
  exports: [EmailChannel],
})
export class EmailModule implements OnApplicationShutdown {
  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  /**
   * Instances made with moduleRef.create get no lifecycle hooks, so the module
   * closes the provider. This runs in the last shutdown phase, after
   * @nestjs/bullmq has closed the worker and its jobs have finished, so no send
   * is cut off.
   */
  onApplicationShutdown(): void {
    this.provider.close?.();
  }
}
