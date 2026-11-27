import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { EmailModule } from './email.module.js';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.js';
import { ResendProvider } from './resend.provider.js';
import { SmtpProvider } from './smtp.provider.js';

async function emailModuleWith(env: Record<string, unknown>) {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => env] }),
      EmailModule,
    ],
  }).compile();
  return { module, provider: module.get<EmailProvider>(EMAIL_PROVIDER, { strict: false }) };
}

describe('EmailModule', () => {
  it('uses SMTP when EMAIL_PROVIDER=smtp, and closes its pool on shutdown', async () => {
    const { module, provider } = await emailModuleWith({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
    });
    expect(provider).toBeInstanceOf(SmtpProvider);

    const close = vi.spyOn(provider as SmtpProvider, 'close');
    await module.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('uses Resend when EMAIL_PROVIDER=resend', async () => {
    const { module, provider } = await emailModuleWith({
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test_key',
    });
    expect(provider).toBeInstanceOf(ResendProvider);
    expect(provider.name).toBe('resend');
    await module.close();
  });
});
